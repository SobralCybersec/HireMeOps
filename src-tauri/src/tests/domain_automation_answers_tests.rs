use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

fn context_with(known: [(&str, &str); 2]) -> AnswerContext {
    AnswerContext {
        provider: Provider::Disabled,
        profile_id: "profile-1".into(),
        summary: String::new(),
        cv_text: String::new(),
        known: known
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect(),
    }
}

#[test]
fn known_facts_clean_values_and_fallbacks() {
    assert_eq!(clean_value("  value  ").as_deref(), Some("value"));
    assert!(clean_value("  ").is_none());

    let facts = HashMap::from([
        ("yearsExperience".into(), " 5 ".into()),
        ("salaryMin".into(), "  ".into()),
        ("phone".into(), "555-0100".into()),
        ("linkedin".into(), "https://linkedin.test/p".into()),
        ("location".into(), "Recife".into()),
    ]);
    assert_eq!(fact_value(&facts, "yearsExperience").as_deref(), Some("5"));
    assert!(fact_value(&facts, "salaryMin").is_none());

    let mut known = HashMap::new();
    add_experience_fact(&mut known, &facts);
    assert!(known.values().any(|value| value == "5"));
    assert!(!known.values().any(|value| value == "2"));
    assert!(!known.keys().any(|key| key.contains("salary")));

    let contact = crate::domain::profile_variants::ContactInfo {
        email: Some("person@example.test".into()),
        phone: Some("fallback-phone".into()),
        website: Some("https://portfolio.test".into()),
        location: "Fallback City".into(),
        ..Default::default()
    };
    add_contact_facts(&mut known, &facts, &contact);
    add_summary_fact(&mut known, " Summary ", "CV text");
    assert!(known.values().any(|value| value == "555-0100"));
    assert!(known.values().any(|value| value == "person@example.test"));
    assert!(known
        .values()
        .any(|value| value == "https://portfolio.test"));
    assert!(known.values().any(|value| value == "Recife"));
    assert!(known.values().any(|value| value == "Summary"));
}

#[test]
fn missing_experience_and_contact_use_expected_defaults() {
    let facts = HashMap::new();
    let mut known = HashMap::new();
    add_experience_fact(&mut known, &facts);
    add_contact_facts(
        &mut known,
        &facts,
        &crate::domain::profile_variants::ContactInfo {
            phone: Some(" 999 ".into()),
            website: Some("  https://site.test ".into()),
            email: Some(" ".into()),
            location: "  ".into(),
            ..Default::default()
        },
    );
    add_summary_fact(&mut known, "", " CV fallback ");
    assert!(known.values().any(|value| value == "2"));
    assert!(known.values().any(|value| value == "999"));
    assert!(known.values().any(|value| value == "https://site.test"));
    assert!(known.values().any(|value| value == "CV fallback"));
}

#[test]
fn binary_answers_cover_sponsorship_capability_and_invalid_questions() {
    let yes_no = vec!["Yes".into(), "No".into()];
    assert_eq!(
        binary_answer("Need visa sponsorship?", &yes_no).as_deref(),
        Some("No")
    );
    assert_eq!(
        binary_answer("Are you authorized to work?", &yes_no).as_deref(),
        Some("Yes")
    );
    assert_eq!(
        binary_answer("Will you need sponsorship?", &yes_no).as_deref(),
        Some("No")
    );
    assert_eq!(
        binary_answer("Do you have experience with Rust?", &yes_no).as_deref(),
        Some("Yes")
    );
    assert!(binary_answer("What is your preferred city?", &yes_no).is_none());
    assert!(binary_answer("Do you know Rust?", &["Yes".into()]).is_none());
    assert!(binary_answer("Do you know Rust?", &["Maybe".into(), "No".into()]).is_none());

    let pt = vec!["Sim".into(), "Não".into()];
    assert_eq!(
        binary_answer("Você domina Rust?", &pt).as_deref(),
        Some("Sim")
    );
    assert_eq!(
        binary_answer("Tem autorização de trabalho?", &pt).as_deref(),
        Some("Sim")
    );
}

#[test]
fn question_constraints_preserve_options_and_length_rules() {
    let options = vec!["Yes".into(), "No".into()];
    let single = question_constraint(&options, None, false);
    assert!(single.contains("EXACTLY ONE option"));
    assert!(single.contains("Yes | No"));

    let multi = question_constraint(&options, None, true);
    assert!(multi.contains("SELECT ALL correct options"));
    assert!(multi.contains("Yes | No"));
    assert!(question_constraint(&[], Some(15), false).contains("ONLY a number"));
    assert!(question_constraint(&[], Some(80), false).contains("at most 80"));
    assert_eq!(question_constraint(&[], None, false), "");
}

#[test]
fn context_answer_lookup_is_case_insensitive_and_keyword_based() {
    let context = context_with([
        ("years of experience|anos de experi", "5"),
        ("email|e-mail", "person@example.test"),
    ]);
    assert_eq!(
        context
            .known_answer("How many YEARS OF EXPERIENCE?")
            .as_deref(),
        Some("5")
    );
    assert_eq!(
        context.known_answer("E-MAIL address").as_deref(),
        Some("person@example.test")
    );
    assert!(context.known_answer("Unrelated question").is_none());
}

#[tokio::test]
async fn generate_form_answers_uses_profile_facts_before_ai() {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES ('p1', 'Test', 'now', 'now', 1)",
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO profile_variants
             (id, profile_id, name, target_title, summary, created_at, updated_at)
             VALUES ('v1', 'p1', 'Base', 'Engineer', 'Summary', 'now', 'now')",
    )
    .execute(&db)
    .await
    .unwrap();
    for (id, key, value) in [
        ("f1", "email", "person@example.test"),
        ("f2", "yearsExperience", "4"),
    ] {
        sqlx::query(
            "INSERT INTO profile_facts
                 (id, profile_id, fact_key, fact_value, source, updated_at)
                 VALUES (?1, 'p1', ?2, ?3, 'test', 'now')",
        )
        .bind(id)
        .bind(key)
        .bind(value)
        .execute(&db)
        .await
        .unwrap();
    }
    sqlx::query(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('ai_providers', ?1, 'now')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(serde_json::json!([{
            "kind": "browser",
            "label": "Test",
            "endpointUrl": "",
            "apiKeyStored": false,
            "defaultModel": "chatgpt/model"
        }]).to_string())
        .execute(&db)
        .await
        .unwrap();

    let questions = vec![
        serde_json::json!({"label": "Email address"}),
        serde_json::json!({"label": "Years of experience", "maxLength": 10}),
        serde_json::json!({"label": "Are you authorized to work?", "options": ["Yes", "No"]}),
        serde_json::json!({"label": "Do you have experience with Rust?", "options": ["Yes", "No"]}),
        serde_json::json!({"label": "  "}),
    ];
    let (answers, human) = generate_form_answers(&db, "p1", &questions).await.unwrap();
    assert_eq!(human, 0);
    assert_eq!(answers["Email address"], "person@example.test");
    assert_eq!(answers["Years of experience"], "4");
    assert_eq!(answers["Are you authorized to work?"], "Yes");
    assert_eq!(answers["Do you have experience with Rust?"], "Yes");
    assert!(!answers.contains_key("  "));
}
