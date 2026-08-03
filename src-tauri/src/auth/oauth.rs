//! Subscription OAuth 2.0 + PKCE login for AI providers (Claude Pro/Max, ChatGPT).
//! Key: code_challenge — PKCE S256 challenge, base64url(sha256(verifier))
//! Key: begin — step 1, mints PKCE verifier + state, returns provider authorize URL
//! Key: complete — step 3 (manual paste), validates state, exchanges code for tokens, persists
//! Key: await_callback — step 3 (loopback), captures code from local listener, exchanges for tokens
//! Key: refresh — re-exchanges the stored refresh token, persists the new token set
//! Key: valid_access_token — accessor the AI layer calls; refreshes transparently if stale

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::domain::{DomainError, DomainResult};

#[derive(Debug, Clone)]
pub struct OAuthProviderConfig {
    pub kind: &'static str,
    pub authorize_url: &'static str,
    pub token_url: &'static str,
    pub client_id: &'static str,
    pub client_secret: Option<&'static str>,
    pub redirect_uri: &'static str,
    pub scope: &'static str,
    pub extra_authorize: &'static [(&'static str, &'static str)],
    pub token_body_json: bool,
    pub token_includes_state: bool,
}

impl OAuthProviderConfig {
    fn loopback_port(&self) -> Option<u16> {
        let authority = self
            .redirect_uri
            .strip_prefix("http://")?
            .split('/')
            .next()?;
        if !(authority.starts_with("localhost:") || authority.starts_with("127.0.0.1:")) {
            return None;
        }
        authority.rsplit(':').next()?.parse::<u16>().ok()
    }
}

pub fn provider_config(kind: &str) -> Option<OAuthProviderConfig> {
    match kind {
        "anthropic" | "anthropic_compatible" => Some(OAuthProviderConfig {
            kind: "anthropic",
            authorize_url: "https://claude.ai/oauth/authorize",
            token_url: "https://console.anthropic.com/v1/oauth/token",
            client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            client_secret: None,
            redirect_uri: "https://console.anthropic.com/oauth/code/callback",
            scope: "org:create_api_key user:profile user:inference",
            extra_authorize: &[("code", "true")],
            token_body_json: true,
            token_includes_state: true,
        }),
        "openai" => Some(OAuthProviderConfig {
            kind: "openai",
            authorize_url: "https://auth.openai.com/oauth/authorize",
            token_url: "https://auth.openai.com/oauth/token",
            client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
            client_secret: None,
            redirect_uri: "http://localhost:1455/auth/callback",
            scope: "openid profile email offline_access",
            extra_authorize: &[],
            token_body_json: false,
            token_includes_state: false,
        }),
        _ => None,
    }
}

pub fn supports_oauth(kind: &str) -> bool {
    provider_config(kind).is_some()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TokenSet {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_at: Option<i64>,
}

impl TokenSet {
    pub fn is_stale(&self, now: i64, skew: i64) -> bool {
        match self.expires_at {
            Some(exp) => now + skew >= exp,
            None => true,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    pub connected: bool,
    pub expires_at: Option<i64>,
    pub can_refresh: bool,
}

impl OAuthStatus {
    fn disconnected() -> Self {
        Self {
            connected: false,
            expires_at: None,
            can_refresh: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStart {
    pub authorize_url: String,
    pub state: String,
    pub uses_loopback: bool,
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn base64url(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        }
    }
    out
}

fn gen_random_b64() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    base64url(&bytes)
}

pub fn code_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    base64url(&h.finalize())
}

pub fn parse_redirect(input: &str) -> Option<(String, Option<String>)> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }

    if let Some(qpos) = s.find('?') {
        if s[..qpos].contains("://") {
            let query = &s[qpos + 1..];
            let query = query.split('#').next().unwrap_or(query);
            let mut code = None;
            let mut state = None;
            for pair in query.split('&') {
                let mut it = pair.splitn(2, '=');
                match (it.next(), it.next()) {
                    (Some("code"), Some(v)) => code = Some(url_decode(v)),
                    (Some("state"), Some(v)) => state = Some(url_decode(v)),
                    _ => {}
                }
            }
            return code.map(|c| (c, state));
        }
    }

    if let Some((code, state)) = s.split_once('#') {
        let code = code.trim();
        let state = state.trim();
        if code.is_empty() {
            return None;
        }
        return Some((
            code.to_string(),
            (!state.is_empty()).then(|| state.to_string()),
        ));
    }

    Some((s.to_string(), None))
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn token_set_from_response(
    v: &serde_json::Value,
    prev_refresh: Option<String>,
    now: i64,
) -> DomainResult<TokenSet> {
    let access_token = v
        .get("access_token")
        .and_then(|a| a.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| DomainError::Other(anyhow::anyhow!("token response missing access_token")))?
        .to_string();

    let refresh_token = v
        .get("refresh_token")
        .and_then(|r| r.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or(prev_refresh);

    let expires_at = v
        .get("expires_in")
        .and_then(|e| e.as_i64())
        .map(|secs| now + secs);

    Ok(TokenSet {
        access_token,
        refresh_token,
        expires_at,
    })
}

struct Pending {
    kind: String,
    verifier: String,
}

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    static P: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

const KEYRING_SERVICE: &str = "com.hiremeops.oauth";

fn keyring_entry(kind: &str) -> DomainResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, kind)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("keyring open ({kind}): {e}")))
}

fn store_tokens(kind: &str, tokens: &TokenSet) -> DomainResult<()> {
    let blob = serde_json::to_string(tokens)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("serialize tokens: {e}")))?;
    keyring_entry(kind)?
        .set_password(&blob)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("keyring store ({kind}): {e}")))
}

fn load_tokens(kind: &str) -> DomainResult<Option<TokenSet>> {
    match keyring_entry(kind)?.get_password() {
        Ok(blob) => serde_json::from_str(&blob)
            .map(Some)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("parse stored tokens: {e}"))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(DomainError::Other(anyhow::anyhow!(
            "keyring read ({kind}): {e}"
        ))),
    }
}

fn delete_tokens(kind: &str) -> DomainResult<()> {
    match keyring_entry(kind)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(DomainError::Other(anyhow::anyhow!(
            "keyring delete ({kind}): {e}"
        ))),
    }
}

fn http_client() -> DomainResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| DomainError::Other(anyhow::anyhow!("build oauth http client: {e}")))
}

async fn post_token(
    cfg: &OAuthProviderConfig,
    params: Vec<(&str, String)>,
    prev_refresh: Option<String>,
) -> DomainResult<TokenSet> {
    let client = http_client()?;
    let req = if cfg.token_body_json {
        let map: serde_json::Map<String, serde_json::Value> = params
            .into_iter()
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect();
        client
            .post(cfg.token_url)
            .json(&serde_json::Value::Object(map))
    } else {
        client.post(cfg.token_url).form(&params)
    };

    let resp = req
        .send()
        .await
        .map_err(|e| DomainError::Other(anyhow::anyhow!("oauth token request failed: {e}")))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| DomainError::Other(anyhow::anyhow!("read token response: {e}")))?;
    if !status.is_success() {
        return Err(DomainError::Other(anyhow::anyhow!(
            "oauth token endpoint returned {status}: {body}"
        )));
    }
    let v: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| DomainError::Other(anyhow::anyhow!("parse token response: {e}; {body}")))?;
    token_set_from_response(&v, prev_refresh, now_epoch())
}

pub fn begin(kind: &str) -> DomainResult<AuthStart> {
    let cfg = provider_config(kind)
        .ok_or_else(|| DomainError::InvalidInput(format!("{kind} does not support OAuth login")))?;

    let verifier = gen_random_b64();
    let challenge = code_challenge(&verifier);
    let state = gen_random_b64();

    let mut url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        cfg.authorize_url,
        percent_encode(cfg.client_id),
        percent_encode(cfg.redirect_uri),
        percent_encode(cfg.scope),
        percent_encode(&state),
        percent_encode(&challenge),
    );
    for (k, v) in cfg.extra_authorize {
        url.push('&');
        url.push_str(&format!("{}={}", percent_encode(k), percent_encode(v)));
    }

    pending().lock().unwrap().insert(
        state.clone(),
        Pending {
            kind: cfg.kind.to_string(),
            verifier,
        },
    );

    Ok(AuthStart {
        authorize_url: url,
        state,
        uses_loopback: cfg.loopback_port().is_some(),
    })
}

pub async fn complete(kind: &str, redirect_input: &str) -> DomainResult<OAuthStatus> {
    let cfg = provider_config(kind)
        .ok_or_else(|| DomainError::InvalidInput(format!("{kind} does not support OAuth login")))?;

    let (code, state) = parse_redirect(redirect_input).ok_or_else(|| {
        DomainError::InvalidInput("could not find an auth code in that value".into())
    })?;

    finish_login(&cfg, code, state).await
}

pub async fn await_callback(kind: &str, timeout_secs: u64) -> DomainResult<OAuthStatus> {
    let cfg = provider_config(kind)
        .ok_or_else(|| DomainError::InvalidInput(format!("{kind} does not support OAuth login")))?;
    let port = cfg.loopback_port().ok_or_else(|| {
        DomainError::InvalidInput(format!("{kind} does not use a loopback redirect"))
    })?;

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| {
            DomainError::Other(anyhow::anyhow!(
                "cannot listen on loopback port {port} for {kind} sign-in \
                 (another attempt may still be open): {e}"
            ))
        })?;

    let (code, state) = capture_loopback_code(&listener, timeout_secs).await?;
    finish_login(&cfg, code, state).await
}

async fn capture_loopback_code(
    listener: &tokio::net::TcpListener,
    timeout_secs: u64,
) -> DomainResult<(String, Option<String>)> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let wait = async {
        loop {
            let (mut sock, _) = listener
                .accept()
                .await
                .map_err(|e| DomainError::Other(anyhow::anyhow!("loopback accept failed: {e}")))?;

            let mut buf = [0u8; 4096];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]);
            let target = head
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("");
            let captured = parse_request_target(target);

            let page = if captured.is_some() {
                "<!doctype html><meta charset=utf-8><title>Signed in</title>\
                 <body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
                 <h2>✓ Signed in</h2><p>You can close this tab and return to HireMeOps.</p>"
            } else {
                "<!doctype html><meta charset=utf-8><title>Waiting</title>\
                 <body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
                 <p>Waiting for authorization…</p>"
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                page.len(),
                page
            );
            let _ = sock.write_all(resp.as_bytes()).await;
            let _ = sock.shutdown().await;

            if let Some(cs) = captured {
                return Ok(cs);
            }
        }
    };

    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), wait).await {
        Ok(res) => res,
        Err(_) => Err(DomainError::InvalidInput(
            "timed out waiting for the browser sign-in to complete".into(),
        )),
    }
}

async fn finish_login(
    cfg: &OAuthProviderConfig,
    code: String,
    state: Option<String>,
) -> DomainResult<OAuthStatus> {
    let verifier = {
        let mut guard = pending().lock().unwrap();
        let key = match &state {
            Some(st) => {
                if !guard.contains_key(st) {
                    return Err(DomainError::InvalidInput(
                        "state mismatch — restart the login".into(),
                    ));
                }
                st.clone()
            }
            None => guard
                .iter()
                .find(|(_, p)| p.kind == cfg.kind)
                .map(|(k, _)| k.clone())
                .ok_or_else(|| {
                    DomainError::InvalidInput("no pending login — start again".into())
                })?,
        };
        let p = guard
            .remove(&key)
            .ok_or_else(|| DomainError::InvalidInput("pending login entry vanished".into()))?;
        if p.kind != cfg.kind {
            return Err(DomainError::InvalidInput(
                "state does not match provider".into(),
            ));
        }
        p.verifier
    };

    let mut params: Vec<(&str, String)> = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", cfg.redirect_uri.to_string()),
        ("client_id", cfg.client_id.to_string()),
        ("code_verifier", verifier),
    ];
    if cfg.token_includes_state {
        if let Some(st) = state {
            params.push(("state", st));
        }
    }
    if let Some(secret) = cfg.client_secret {
        params.push(("client_secret", secret.to_string()));
    }

    let tokens = post_token(cfg, params, None).await?;
    store_tokens(cfg.kind, &tokens)?;
    Ok(status_from_tokens(Some(&tokens)))
}

fn parse_request_target(target: &str) -> Option<(String, Option<String>)> {
    let query = target.split('?').nth(1)?;
    let query = query.split('#').next().unwrap_or(query);
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        match (it.next(), it.next()) {
            (Some("code"), Some(v)) => code = Some(url_decode(v)),
            (Some("state"), Some(v)) => state = Some(url_decode(v)),
            _ => {}
        }
    }
    code.map(|c| (c, state))
}

pub async fn refresh(kind: &str) -> DomainResult<TokenSet> {
    let cfg = provider_config(kind)
        .ok_or_else(|| DomainError::InvalidInput(format!("{kind} does not support OAuth login")))?;
    let current = load_tokens(cfg.kind)?
        .ok_or_else(|| DomainError::InvalidInput(format!("{kind} is not connected")))?;
    let refresh_token = current.refresh_token.clone().ok_or_else(|| {
        DomainError::InvalidInput(format!("{kind} has no refresh token — reconnect"))
    })?;

    let mut params: Vec<(&str, String)> = vec![
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.clone()),
        ("client_id", cfg.client_id.to_string()),
    ];
    if let Some(secret) = cfg.client_secret {
        params.push(("client_secret", secret.to_string()));
    }

    let tokens = post_token(&cfg, params, Some(refresh_token)).await?;
    store_tokens(cfg.kind, &tokens)?;
    Ok(tokens)
}

pub async fn valid_access_token(kind: &str) -> DomainResult<Option<String>> {
    let cfg = match provider_config(kind) {
        Some(c) => c,
        None => return Ok(None),
    };
    let current = match load_tokens(cfg.kind)? {
        Some(t) => t,
        None => return Ok(None),
    };
    if current.is_stale(now_epoch(), 60) && current.refresh_token.is_some() {
        match refresh(cfg.kind).await {
            Ok(fresh) => return Ok(Some(fresh.access_token)),
            Err(e) => tracing::warn!("oauth refresh for {kind} failed: {e}"),
        }
    }
    Ok(Some(current.access_token))
}

pub fn status(kind: &str) -> DomainResult<OAuthStatus> {
    if provider_config(kind).is_none() {
        return Ok(OAuthStatus::disconnected());
    }
    Ok(status_from_tokens(load_tokens(kind)?.as_ref()))
}

pub fn logout(kind: &str) -> DomainResult<()> {
    delete_tokens(kind)
}

fn status_from_tokens(tokens: Option<&TokenSet>) -> OAuthStatus {
    match tokens {
        Some(t) => OAuthStatus {
            connected: true,
            expires_at: t.expires_at,
            can_refresh: t.refresh_token.is_some(),
        },
        None => OAuthStatus::disconnected(),
    }
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_has_no_padding_and_is_urlsafe() {
        assert_eq!(base64url(b"sure."), "c3VyZS4");
        let enc = base64url(&[251, 255, 191]);
        assert!(!enc.contains('+') && !enc.contains('/') && !enc.contains('='));
    }

    #[test]
    fn pkce_challenge_matches_known_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            code_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_is_43_chars_and_random() {
        let a = gen_random_b64();
        let b = gen_random_b64();
        assert_eq!(a.len(), 43, "32 bytes base64url-unpadded = 43 chars");
        assert_ne!(a, b);
    }

    #[test]
    fn parse_redirect_handles_all_forms() {
        assert_eq!(parse_redirect("abc123"), Some(("abc123".into(), None)));
        assert_eq!(
            parse_redirect("  abc123#xyz "),
            Some(("abc123".into(), Some("xyz".into())))
        );
        assert_eq!(
            parse_redirect("http://localhost:1455/auth/callback?code=A%2FB&state=st#frag"),
            Some(("A/B".into(), Some("st".into())))
        );
        assert_eq!(
            parse_redirect("https://x/cb?foo=1&code=only"),
            Some(("only".into(), None))
        );
        assert_eq!(parse_redirect("   "), None);
        assert_eq!(parse_redirect("#state-only"), None);
    }

    #[test]
    fn token_set_carries_forward_refresh_and_computes_expiry() {
        let resp = json!({ "access_token": "AT", "expires_in": 3600 });
        let ts = token_set_from_response(&resp, Some("OLD_RT".into()), 1_000).unwrap();
        assert_eq!(ts.access_token, "AT");
        assert_eq!(ts.refresh_token.as_deref(), Some("OLD_RT"));
        assert_eq!(ts.expires_at, Some(4_600));

        let resp2 = json!({ "access_token": "AT2", "refresh_token": "NEW_RT" });
        let ts2 = token_set_from_response(&resp2, Some("OLD_RT".into()), 0).unwrap();
        assert_eq!(ts2.refresh_token.as_deref(), Some("NEW_RT"));
        assert_eq!(ts2.expires_at, None);
    }

    #[test]
    fn missing_access_token_is_an_error() {
        let resp = json!({ "token_type": "bearer" });
        assert!(token_set_from_response(&resp, None, 0).is_err());
    }

    #[test]
    fn staleness_respects_skew_and_unknown_expiry() {
        let t = TokenSet {
            access_token: "x".into(),
            refresh_token: None,
            expires_at: Some(1_000),
        };
        assert!(!t.is_stale(900, 60), "far from expiry → fresh");
        assert!(t.is_stale(950, 60), "within skew → stale");
        assert!(t.is_stale(1_000, 0), "at expiry → stale");
        let unknown = TokenSet {
            access_token: "x".into(),
            refresh_token: None,
            expires_at: None,
        };
        assert!(unknown.is_stale(0, 0), "unknown expiry → stale");
    }

    #[test]
    fn provider_table_covers_the_three_subscription_providers() {
        assert!(supports_oauth("anthropic"));
        assert!(supports_oauth("anthropic_compatible"));
        assert!(supports_oauth("openai"));
        assert!(!supports_oauth("ollama"));
    }

    #[test]
    fn begin_builds_a_pkce_authorize_url_and_stashes_state() {
        let start = begin("anthropic").unwrap();
        assert!(start
            .authorize_url
            .starts_with("https://claude.ai/oauth/authorize?"));
        assert!(start.authorize_url.contains("code_challenge_method=S256"));
        assert!(start.authorize_url.contains("response_type=code"));
        assert!(
            start.authorize_url.contains("code=true"),
            "extra param present"
        );
        assert!(start
            .authorize_url
            .contains(&format!("state={}", start.state)));
        assert!(pending().lock().unwrap().contains_key(&start.state));
    }

    #[test]
    fn begin_rejects_non_oauth_provider() {
        assert!(begin("ollama").is_err());
    }

    #[test]
    fn parse_request_target_extracts_code_and_state() {
        assert_eq!(
            parse_request_target("/auth/callback?code=A%2FB&state=st"),
            Some(("A/B".into(), Some("st".into())))
        );
        assert_eq!(
            parse_request_target("/cb?code=only"),
            Some(("only".into(), None))
        );
        assert_eq!(
            parse_request_target("/cb?code=c&state=s#frag"),
            Some(("c".into(), Some("s".into())))
        );
        assert_eq!(parse_request_target("/favicon.ico"), None);
        assert_eq!(parse_request_target("/cb?state=only"), None);
        assert_eq!(parse_request_target("/"), None);
    }

    #[test]
    fn loopback_port_only_matches_local_http_redirects() {
        let local = OAuthProviderConfig {
            redirect_uri: "http://localhost:1455/auth/callback",
            ..probe_cfg()
        };
        assert_eq!(local.loopback_port(), Some(1455));
        let ip = OAuthProviderConfig {
            redirect_uri: "http://127.0.0.1:8788/cb",
            ..probe_cfg()
        };
        assert_eq!(ip.loopback_port(), Some(8788));

        let hosted = OAuthProviderConfig {
            redirect_uri: "https://console.anthropic.com/oauth/code/callback",
            ..probe_cfg()
        };
        assert_eq!(hosted.loopback_port(), None);
        let remote = OAuthProviderConfig {
            redirect_uri: "http://example.com:80/cb",
            ..probe_cfg()
        };
        assert_eq!(remote.loopback_port(), None);
    }

    fn probe_cfg() -> OAuthProviderConfig {
        OAuthProviderConfig {
            kind: "test",
            authorize_url: "https://example.com/authorize",
            token_url: "https://example.com/token",
            client_id: "cid",
            client_secret: None,
            redirect_uri: "http://localhost:1/cb",
            scope: "openid",
            extra_authorize: &[],
            token_body_json: false,
            token_includes_state: false,
        }
    }
}
