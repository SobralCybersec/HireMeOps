//! Browser driver implementations, gated behind the `real-browser` cargo feature.
//! Key: BrowserDriver — trait implemented by ChromiumDriver (this file) and playwright::PlaywrightDriver.
//! Key: SessionSpec — input to `open()`, carries user_data_dir/extensions/headless.
//! Key: PageState — probe() result: CaptchaWall, ApplyForm, DailyLimitReached, NoAction.
//! Key: ChromiumDriver — legacy chromiumoxide/CDP driver.

pub mod playwright;
pub mod screencast;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::page::Page;
use futures::StreamExt as _;
use tokio::sync::Mutex;

use crate::domain::automation::{
    BrowserDriver, EasyApplyInput, PageState, SearchJobsInput, SearchJobsResult, SessionSpec,
};
use crate::domain::{DomainError, DomainResult};

struct Session {
    browser: Browser,
    page: Page,
}

pub struct ChromiumDriver {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    data_root: PathBuf,
}

impl ChromiumDriver {
    #[allow(dead_code)]
    pub fn new(data_root: impl Into<PathBuf>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            data_root: data_root.into(),
        }
    }
}

fn cx_err(e: impl std::error::Error + Send + Sync + 'static) -> DomainError {
    DomainError::Other(anyhow::anyhow!(e))
}

const CLASSIFY_PAGE_JS: &str = r##"(() => {
  const html = (document.documentElement.outerHTML || '').toLowerCase();
  const captchaSignals = ['recaptcha','hcaptcha','cf-turnstile','g-recaptcha','challenge-form','px-captcha','funcaptcha','arkoselabs','datadome'];
  const hasCaptcha = captchaSignals.some(s => html.includes(s))
    || !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],iframe[title*="challenge" i],div.g-recaptcha,#cf-chl-widget,#challenge-form');
  if (hasCaptcha) return 'captcha';
  // LinkedIn surfaces this inline feedback when the user has hit their daily
  // Easy Apply cap. Detect it before checking for the form so we surface the
  // correct state instead of treating a blocked modal as a fillable form.
  const feedbackEls = document.querySelectorAll('.artdeco-inline-feedback__message');
  for (const el of feedbackEls) {
    if ((el.textContent || '').toLowerCase().includes('exceeded the daily application limit')) {
      return 'daily_limit';
    }
  }
  const form = document.querySelector('form input:not([type=hidden]):not([type=submit]):not([type=button]),form textarea,form select,[data-easy-apply],[aria-label*="Easy Apply" i],button[aria-label*="Easy Apply" i]');
  if (form) return 'apply';
  return 'none';
})()"##;

const EXTRACT_HR_JS: &str = r##"(() => {
  const card = document.querySelector(
    '.hirer-card__hirer-information, .job-details-jobs-unified-top-card__hiring-manager, [data-test-job-insight-type="hiring-manager"]'
  );
  if (!card) return null;
  const nameEl = card.querySelector('span[aria-hidden="true"], .hirer-card__hirer-name, .app-aware-link span');
  const linkEl = card.querySelector('a[href*="linkedin.com/in/"]');
  if (!nameEl && !linkEl) return null;
  return JSON.stringify({
    name: (nameEl && nameEl.textContent || '').trim() || null,
    profile_url: (linkEl && linkEl.href) || null,
  });
})()"##;

const FILL_EASY_APPLY_JS: &str = r##"(() => {
  const answers = __ANSWERS_JSON__;
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const controls = Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select'
  ));
  const labelText = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && l.textContent) return norm(l.textContent);
    }
    const wrap = el.closest('label');
    if (wrap && wrap.textContent) return norm(wrap.textContent);
    const lb = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
    return norm(lb);
  };
  const setNative = (el, val) => {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let filled = 0;
  const used = new Set();
  for (const ans of answers) {
    const want = norm(ans.label);
    if (!want) continue;
    const target = controls.find(el => {
      if (used.has(el)) return false;
      const lbl = labelText(el);
      return lbl && (lbl.includes(want) || want.includes(lbl));
    });
    if (!target) continue;
    used.add(target);
    if (target.tagName === 'SELECT') {
      const want2 = norm(ans.value);
      const opt = Array.from(target.options).find(o =>
        norm(o.textContent).includes(want2) || norm(o.value).includes(want2));
      if (opt) {
        target.value = opt.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
    } else {
      setNative(target, String(ans.value));
      filled++;
    }
  }
  return filled;
})()"##;

fn extension_args(paths: &[String]) -> Vec<String> {
    let joined = paths
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(",");
    if joined.is_empty() {
        return Vec::new();
    }
    vec![
        format!("--disable-extensions-except={joined}"),
        format!("--load-extension={joined}"),
    ]
}

impl BrowserDriver for ChromiumDriver {
    async fn open(&self, spec: &SessionSpec) -> DomainResult<String> {
        let udd: PathBuf = {
            let p = PathBuf::from(&spec.user_data_dir);
            if p.is_absolute() {
                p
            } else {
                self.data_root.join(&p)
            }
        };

        tokio::fs::create_dir_all(&udd)
            .await
            .map_err(|e| DomainError::Other(anyhow::anyhow!("create user-data-dir: {e}")))?;

        let mut builder = BrowserConfig::builder()
            .user_data_dir(&udd)
            .with_head()
            .window_size(1280, 900)
            .arg("--disable-gpu")
            .arg("--no-sandbox")
            .arg("--disable-dev-shm-usage");
        for arg in extension_args(&spec.extensions) {
            builder = builder.arg(arg);
        }
        let config = builder
            .build()
            .map_err(|e| DomainError::Other(anyhow::anyhow!("BrowserConfig::build: {e}")))?;

        let (browser, mut handler) = Browser::launch(config).await.map_err(cx_err)?;

        tokio::spawn(async move {
            while let Some(h) = handler.next().await {
                if let Err(e) = h {
                    tracing::debug!("chromiumoxide handler: {e}");
                }
            }
        });

        let page = browser.new_page("about:blank").await.map_err(cx_err)?;

        let handle = crate::util::new_id();

        let mut map = self.sessions.lock().await;
        map.insert(handle.clone(), Session { browser, page });

        tracing::info!(handle = %handle, udd = %udd.display(), "ChromiumDriver: session opened");
        Ok(handle)
    }

    async fn navigate(&self, handle: &str, url: &str) -> DomainResult<()> {
        let map = self.sessions.lock().await;
        let session = map
            .get(handle)
            .ok_or_else(|| DomainError::InvalidInput(format!("no session for handle: {handle}")))?;

        session.page.goto(url).await.map_err(cx_err)?;

        tracing::debug!(handle = %handle, url = %url, "ChromiumDriver: navigated");
        Ok(())
    }

    async fn probe(&self, handle: &str) -> DomainResult<PageState> {
        let map = self.sessions.lock().await;
        let session = map
            .get(handle)
            .ok_or_else(|| DomainError::InvalidInput(format!("no session for handle: {handle}")))?;

        let result = session
            .page
            .evaluate(CLASSIFY_PAGE_JS)
            .await
            .map_err(cx_err)?;
        let class: String = result.into_value().map_err(cx_err)?;

        let state = match class.as_str() {
            "captcha" => PageState::CaptchaWall,
            "apply" => PageState::ApplyForm,
            "daily_limit" => PageState::DailyLimitReached,
            _ => PageState::NoAction,
        };
        tracing::debug!(handle = %handle, ?state, "ChromiumDriver: probe");
        Ok(state)
    }

    async fn fill_easy_apply(&self, handle: &str, input: &EasyApplyInput) -> DomainResult<()> {
        let map = self.sessions.lock().await;
        let session = map
            .get(handle)
            .ok_or_else(|| DomainError::InvalidInput(format!("no session for handle: {handle}")))?;

        let mut effective_answers = input.answers.clone();
        if let Some(ref cl) = input.cover_letter {
            use crate::domain::automation::AnswerField;
            effective_answers.push(AnswerField {
                label: "Cover letter".to_string(),
                value: cl.clone(),
            });
        }

        let answers_json = serde_json::to_string(&effective_answers)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("serialize answers: {e}")))?;
        let script = FILL_EASY_APPLY_JS.replace("__ANSWERS_JSON__", &answers_json);

        let result = session
            .page
            .evaluate(script.as_str())
            .await
            .map_err(cx_err)?;
        let filled: i64 = result.into_value().unwrap_or(0);

        tracing::info!(
            handle = %handle,
            answers = input.answers.len(),
            filled,
            "ChromiumDriver: fill_easy_apply completed (no submit)"
        );
        Ok(())
    }

    async fn screenshot(&self, handle: &str) -> DomainResult<String> {
        let map = self.sessions.lock().await;
        let session = map
            .get(handle)
            .ok_or_else(|| DomainError::InvalidInput(format!("no session for handle: {handle}")))?;

        let bytes: Vec<u8> = session
            .page
            .screenshot(chromiumoxide::page::ScreenshotParams::default())
            .await
            .map_err(cx_err)?;

        let path = std::env::temp_dir().join(format!("hiremeops-shot-{handle}.png"));
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|e| DomainError::Other(anyhow::anyhow!("write screenshot: {e}")))?;

        let path_str = path
            .to_str()
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("screenshot path is non-UTF-8")))?
            .to_string();

        tracing::debug!(handle = %handle, path = %path_str, "ChromiumDriver: screenshot written");
        Ok(path_str)
    }

    async fn dom_snapshot(&self, handle: &str) -> DomainResult<String> {
        let map = self.sessions.lock().await;
        let session = map
            .get(handle)
            .ok_or_else(|| DomainError::InvalidInput(format!("no session for handle: {handle}")))?;

        let html = session.page.content().await.map_err(cx_err)?;
        tracing::debug!(handle = %handle, bytes = html.len(), "ChromiumDriver: dom_snapshot");
        Ok(html)
    }

    async fn close(&self, handle: &str) -> DomainResult<()> {
        let mut map = self.sessions.lock().await;
        let session = map
            .remove(handle)
            .ok_or_else(|| DomainError::InvalidInput(format!("no session for handle: {handle}")))?;

        if let Err(e) = session.page.close().await {
            tracing::warn!(handle = %handle, "ChromiumDriver: page.close error: {e}");
        }

        let mut browser = session.browser;
        if let Err(e) = browser.close().await {
            tracing::warn!(handle = %handle, "ChromiumDriver: browser.close error: {e}");
        }

        tracing::info!(handle = %handle, "ChromiumDriver: session closed");
        Ok(())
    }

    async fn extract_hr(&self, handle: &str) -> DomainResult<Option<String>> {
        let map = self.sessions.lock().await;
        let session = map
            .get(handle)
            .ok_or_else(|| DomainError::InvalidInput(format!("no session for handle: {handle}")))?;

        let result = session.page.evaluate(EXTRACT_HR_JS).await.map_err(cx_err)?;

        let raw: Option<String> = result.into_value().unwrap_or(None);
        tracing::debug!(handle = %handle, found = raw.is_some(), "ChromiumDriver: extract_hr");
        Ok(raw)
    }

    async fn search_jobs(
        &self,
        _handle: &str,
        _input: &SearchJobsInput,
    ) -> DomainResult<SearchJobsResult> {
        Err(DomainError::NotImplemented(
            "search_jobs is only available via the Playwright driver",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::extension_args;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_paths_returns_empty() {
        assert!(extension_args(&[]).is_empty());
    }

    #[test]
    fn blank_and_empty_paths_are_dropped() {
        assert!(extension_args(&v(&["", "   ", "\t"])).is_empty());
    }

    #[test]
    fn single_path_emits_two_flags() {
        let args = extension_args(&v(&["/ext/one"]));
        assert_eq!(
            args,
            vec![
                "--disable-extensions-except=/ext/one".to_string(),
                "--load-extension=/ext/one".to_string(),
            ]
        );
    }

    #[test]
    fn multiple_paths_are_comma_joined_and_trimmed() {
        let args = extension_args(&v(&["  /ext/a ", "", "/ext/b"]));
        assert_eq!(
            args,
            vec![
                "--disable-extensions-except=/ext/a,/ext/b".to_string(),
                "--load-extension=/ext/a,/ext/b".to_string(),
            ]
        );
    }
}
