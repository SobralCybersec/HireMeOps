use std::collections::HashMap;

use crate::ai::prompt::{
    indeed_answer_prompt, indeed_answer_system, INDEED_ANSWER_PROMPT_VERSION, NEEDS_HUMAN_SENTINEL,
};
use crate::ai::{complete_cached, input_hash, select_provider_resolved, Provider};
use crate::domain::ai::CompletionRequest;
use crate::domain::profile_variants::{ProfileVariantService, ProfileVariantServiceImpl};
use crate::storage::settings::load_ai_providers;

struct AnswerContext {
    provider: Provider,
    profile_id: String,
    summary: String,
    cv_text: String,
    known: HashMap<String, String>,
}

impl AnswerContext {
    async fn load(db: &sqlx::SqlitePool, profile_id: &str) -> Result<Self, String> {
        let (providers, default_index) = load_ai_providers(db).await.map_err(|e| e.to_string())?;
        let provider = select_provider_resolved(&providers, default_index).await;
        if provider.is_disabled() {
            return Err("no AI provider configured".into());
        }

        let (summary, cv_text, contact) = load_variant(db, profile_id).await?;
        let known = load_known_facts(db, profile_id, &summary, &cv_text, &contact).await;
        Ok(Self {
            provider,
            profile_id: profile_id.into(),
            summary,
            cv_text,
            known,
        })
    }

    fn known_answer(&self, label: &str) -> Option<String> {
        let label = label.to_lowercase();
        self.known
            .iter()
            .find(|(keywords, _)| keywords.split('|').any(|keyword| label.contains(keyword)))
            .map(|(_, value)| value.clone())
    }
}

async fn load_variant(
    db: &sqlx::SqlitePool,
    profile_id: &str,
) -> Result<(String, String, crate::domain::profile_variants::ContactInfo), String> {
    let variant = ProfileVariantServiceImpl::new(db.clone())
        .list(profile_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .next();
    Ok(variant
        .as_ref()
        .map(|variant| {
            let summary = if variant.summary.trim().is_empty() {
                variant.headline.clone()
            } else {
                variant.summary.clone()
            };
            (summary, variant.about_text.clone(), variant.contact.clone())
        })
        .unwrap_or_default())
}

async fn load_known_facts(
    db: &sqlx::SqlitePool,
    profile_id: &str,
    summary: &str,
    cv_text: &str,
    contact: &crate::domain::profile_variants::ContactInfo,
) -> HashMap<String, String> {
    let facts: HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT fact_key, fact_value FROM profile_facts WHERE profile_id = ?1",
    )
    .bind(profile_id)
    .fetch_all(db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();
    let mut known = HashMap::new();
    add_experience_fact(&mut known, &facts);
    add_contact_facts(&mut known, &facts, contact);
    add_summary_fact(&mut known, summary, cv_text);
    known
}

fn clean_value(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.trim().to_string())
}

fn fact_value(facts: &HashMap<String, String>, key: &str) -> Option<String> {
    facts.get(key).and_then(|value| clean_value(value))
}

fn add_experience_fact(known: &mut HashMap<String, String>, facts: &HashMap<String, String>) {
    add_known(
        known,
        [
            "years of experience",
            "years experience",
            "how many years",
            "anos de experi",
            "quantos anos",
        ],
        fact_value(facts, "yearsExperience").or_else(|| Some("2".into())),
    );
    add_known(
        known,
        [
            "salary",
            "salário",
            "salario",
            "pretensão",
            "pretensao",
            "remuner",
            "compensation",
        ],
        fact_value(facts, "salaryMin"),
    );
}

fn add_contact_facts(
    known: &mut HashMap<String, String>,
    facts: &HashMap<String, String>,
    contact: &crate::domain::profile_variants::ContactInfo,
) {
    add_known(
        known,
        ["phone", "telefone", "celular", "mobile"],
        fact_value(facts, "phone").or_else(|| contact.phone.as_deref().and_then(clean_value)),
    );
    add_known(known, ["linkedin"], fact_value(facts, "linkedin"));
    add_known(known, ["github"], fact_value(facts, "github"));
    add_known(
        known,
        ["portfolio", "website", "site pessoal", "personal site"],
        fact_value(facts, "portfolio").or_else(|| contact.website.as_deref().and_then(clean_value)),
    );
    add_known(
        known,
        ["e-mail", "email"],
        fact_value(facts, "email").or_else(|| contact.email.as_deref().and_then(clean_value)),
    );
    add_known(
        known,
        ["city", "cidade", "localiz", "location"],
        fact_value(facts, "location")
            .or_else(|| fact_value(facts, "city"))
            .or_else(|| clean_value(&contact.location)),
    );
}

fn add_summary_fact(known: &mut HashMap<String, String>, summary: &str, cv_text: &str) {
    add_known(
        known,
        [
            "summary",
            "resumo",
            "about you",
            "about yourself",
            "sobre você",
            "sobre voce",
            "tell us about yourself",
            "fale sobre você",
            "apresente-se",
            "apresentação pessoal",
            "short bio",
            "brief description",
        ],
        clean_value(summary).or_else(|| clean_value(cv_text)),
    );
}

fn add_known<const N: usize>(
    known: &mut HashMap<String, String>,
    keywords: [&str; N],
    value: Option<String>,
) {
    if let Some(value) = value {
        known.insert(keywords.join("|"), value);
    }
}

fn binary_answer(label: &str, options: &[String]) -> Option<String> {
    let normalized = |value: &str| value.trim().to_lowercase();
    let is_yes = |value: &str| {
        matches!(
            normalized(value).as_str(),
            "yes" | "sim" | "y" | "true" | "verdadeiro"
        )
    };
    let is_no = |value: &str| {
        matches!(
            normalized(value).as_str(),
            "no" | "não" | "nao" | "n" | "false" | "falso"
        )
    };
    if options.len() != 2 || !options.iter().all(|option| is_yes(option) || is_no(option)) {
        return None;
    }
    let label = label.to_lowercase();
    let sponsorship = [
        "sponsor",
        "patroc",
        "visa",
        "visto",
        "work permit",
        "autoriz",
        "authorized",
        "eligible to work",
        "elegív",
        "elegiv",
    ];
    let capability = [
        "experi",
        "experience",
        "conhecimento",
        "familiar",
        "proficien",
        "já trabalh",
        "ja trabalh",
        "sabe utilizar",
        "domina",
        "trabalhou com",
    ];
    if sponsorship.iter().any(|key| label.contains(key)) {
        let authorized = [
            "autoriz",
            "authorized",
            "eligible",
            "elegív",
            "elegiv",
            "permit",
        ];
        let want_yes = authorized.iter().any(|key| label.contains(key));
        return options
            .iter()
            .find(|option| is_yes(option) == want_yes && is_no(option) != want_yes)
            .cloned();
    }
    capability
        .iter()
        .any(|key| label.contains(key))
        .then(|| options.iter().find(|option| is_yes(option)).cloned())
        .flatten()
}

fn question_constraint(options: &[String], max_len: Option<u64>, multi: bool) -> String {
    if !options.is_empty() {
        let mode = if multi {
            "SELECT ALL correct options. Reply with ONLY the chosen option texts VERBATIM in their ORIGINAL language, separated by ' | ', nothing else. This is a knowledge / best-practice question: pick the technically correct options using professional judgment even if not stated in the CV; NEVER output [NEEDS_HUMAN]."
        } else {
            "reply with EXACTLY ONE option, verbatim in its ORIGINAL language, nothing else. Pick the BEST / most-correct option using professional judgment (skill level, best action, education, or yes/no) — grounded in the CV when relevant; NEVER output [NEEDS_HUMAN]."
        };
        return format!(
            "\n(Multiple choice — {mode} Options: {})",
            options.join(" | ")
        );
    }
    match max_len {
        Some(n) if n <= 15 => format!("\n(VERY SHORT field, max {n} characters. This is almost certainly a years-of-experience question about the skill/technology named in the label — reply with ONLY a number of years as a digit, e.g. \"2\". Never write a sentence.)"),
        Some(n) => format!("\n(Answer in at most {n} characters — be concise.)"),
        None => String::new(),
    }
}

struct AnswerQuestion<'a> {
    label: &'a str,
    options: &'a [String],
    max_len: Option<u64>,
    multi: bool,
}

async fn answer_with_ai(
    db: &sqlx::SqlitePool,
    ctx: &AnswerContext,
    question_data: AnswerQuestion<'_>,
    out: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let AnswerQuestion {
        label,
        options,
        max_len,
        multi,
    } = question_data;
    let question = format!("{label}{}", question_constraint(options, max_len, multi));
    let request = CompletionRequest {
        model: ctx.provider.default_model().to_string(),
        prompt: indeed_answer_prompt(&question, &ctx.summary, &ctx.cv_text),
        system: Some(indeed_answer_system()),
        input_hash: input_hash(&[
            INDEED_ANSWER_PROMPT_VERSION,
            &ctx.profile_id,
            label,
            &max_len.map(|n| n.to_string()).unwrap_or_default(),
            &options.join("|"),
        ]),
    };
    match complete_cached(db, &ctx.provider, request).await {
        Ok(response)
            if !response.text.trim().is_empty()
                && !response.text.contains(NEEDS_HUMAN_SENTINEL) =>
        {
            out.insert(label.to_string(), serde_json::json!(response.text.trim()));
            false
        }
        Ok(_) => {
            tracing::info!(question = label, "AI could not answer — needs human");
            true
        }
        Err(error) => {
            tracing::warn!(error = %error, question = label, "form answer draft failed");
            true
        }
    }
}

pub(crate) async fn generate_form_answers(
    db: &sqlx::SqlitePool,
    profile_id: &str,
    unanswered: &[serde_json::Value],
) -> Result<(serde_json::Map<String, serde_json::Value>, usize), String> {
    let ctx = AnswerContext::load(db, profile_id).await?;
    let mut out = serde_json::Map::new();
    let mut human = 0;
    for question in unanswered {
        let label = question
            .get("label")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim();
        if label.is_empty() {
            continue;
        }
        if let Some(value) = ctx.known_answer(label) {
            out.insert(label.to_string(), serde_json::json!(value));
            continue;
        }
        let options = question
            .get("options")
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let max_len = question.get("maxLength").and_then(|v| v.as_u64());
        if options.is_empty() && max_len.is_some_and(|n| n <= 15) {
            if let Some(value) = ctx.known_answer("years of experience") {
                out.insert(label.to_string(), serde_json::json!(value));
                continue;
            }
        }
        if let Some(value) = binary_answer(label, &options) {
            out.insert(label.to_string(), serde_json::json!(value));
            continue;
        }
        human += answer_with_ai(
            db,
            &ctx,
            AnswerQuestion {
                label,
                options: &options,
                max_len,
                multi: question
                    .get("multi")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            },
            &mut out,
        )
        .await as usize;
    }
    Ok((out, human))
}
