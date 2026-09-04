use std::collections::HashMap;

use super::DomainResult;

async fn load_variant_contact(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    role_variant_id: Option<&str>,
) -> crate::domain::profile_variants::ContactInfo {
    let Some(variant_id) = role_variant_id else {
        return Default::default();
    };
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT contact_json FROM profile_variants WHERE id = ?1",
    )
    .bind(variant_id)
    .fetch_optional(&mut **tx)
    .await
    .ok()
    .flatten()
    .flatten()
    .and_then(|raw| serde_json::from_str::<crate::domain::profile_variants::ContactInfo>(&raw).ok())
    .unwrap_or_default()
}

fn contact_answer_specs(
    facts: &HashMap<String, String>,
    contact: &crate::domain::profile_variants::ContactInfo,
) -> [(&'static [&'static str], Option<String>); 9] {
    let clean = |value: &str| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    };
    let fact = |key: &str| facts.get(key).and_then(|value| clean(value));
    let phone = fact("phone").or_else(|| contact.phone.as_deref().and_then(clean));
    let website = fact("portfolio").or_else(|| contact.website.as_deref().and_then(clean));
    let email = fact("email").or_else(|| contact.email.as_deref().and_then(clean));
    [
        (&["phone", "telefone", "celular", "mobile phone"], phone),
        (
            &[
                "pretensão salarial",
                "pretensao salarial",
                "salary expectation",
                "expected salary",
                "salary",
                "remuneração",
            ],
            fact("salaryMin"),
        ),
        (&["linkedin"], fact("linkedin")),
        (&["github"], fact("github")),
        (
            &["portfolio", "website", "personal website", "site"],
            website,
        ),
        (&["email address", "e-mail"], email),
        (
            &[
                "work authorization",
                "autorização de trabalho",
                "elegível para trabalhar",
            ],
            fact("brazilWorkAuth"),
        ),
        (
            &["visa sponsorship", "patrocínio de visto", "sponsorship"],
            fact("visaSponsorship"),
        ),
        (
            &["english", "inglês", "english level", "nível de inglês"],
            fact("englishLevel"),
        ),
    ]
}

pub(super) async fn contact_fact_answers(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    profile_id: &str,
    role_variant_id: Option<&str>,
) -> DomainResult<Vec<serde_json::Value>> {
    let facts: HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT fact_key, fact_value FROM profile_facts WHERE profile_id = ?1",
    )
    .bind(profile_id)
    .fetch_all(&mut **tx)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();
    let contact = load_variant_contact(tx, role_variant_id).await;
    let mut out = Vec::new();
    for (labels, value) in contact_answer_specs(&facts, &contact) {
        if let Some(value) = value {
            for label in labels {
                out.push(serde_json::json!({ "label": label, "value": value }));
            }
        }
    }
    Ok(out)
}

pub(super) fn map_answers(form_answers_json: Option<&str>) -> serde_json::Value {
    let Some(raw) = form_answers_json else {
        return serde_json::json!([]);
    };
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(raw) else {
        return serde_json::json!([]);
    };
    let mapped: Vec<serde_json::Value> = items
        .into_iter()
        .filter_map(|value| {
            let question = value.get("question").and_then(|item| item.as_str())?;
            let answer = value
                .get("answer")
                .and_then(|item| item.as_str())
                .unwrap_or("");
            Some(serde_json::json!({ "label": question, "value": answer }))
        })
        .collect();
    serde_json::Value::Array(mapped)
}
