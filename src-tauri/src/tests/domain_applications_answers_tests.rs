use super::*;
use crate::domain::profile_variants::ContactInfo;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

#[test]
fn contact_specs_prefer_facts_and_ignore_blank_values() {
    let facts = HashMap::from([
        ("phone".into(), " 555-0100 ".into()),
        ("portfolio".into(), " ".into()),
        ("email".into(), "person@example.test".into()),
        ("salaryMin".into(), "5000".into()),
        ("linkedin".into(), "profile-link".into()),
        ("brazilWorkAuth".into(), "yes".into()),
        ("englishLevel".into(), "advanced".into()),
    ]);
    let contact = ContactInfo {
        phone: Some("fallback phone".into()),
        website: Some("https://portfolio.test".into()),
        email: Some("fallback@example.test".into()),
        ..Default::default()
    };
    let specs = contact_answer_specs(&facts, &contact);
    assert_eq!(specs[0].1.as_deref(), Some("555-0100"));
    assert_eq!(specs[1].1.as_deref(), Some("5000"));
    assert_eq!(specs[4].1.as_deref(), Some("https://portfolio.test"));
    assert_eq!(specs[5].1.as_deref(), Some("person@example.test"));
    assert_eq!(specs[6].1.as_deref(), Some("yes"));
    assert_eq!(specs[8].1.as_deref(), Some("advanced"));
}

#[test]
fn map_answers_handles_missing_invalid_and_partial_items() {
    assert_eq!(map_answers(None), serde_json::json!([]));
    assert_eq!(map_answers(Some("not-json")), serde_json::json!([]));
    assert_eq!(
        map_answers(Some(
            r#"[
                    {"question":"Q1","answer":"A1"},
                    {"question":"Q2"},
                    {"answer":"ignored"},
                    "ignored"
                ]"#
        )),
        serde_json::json!([
            {"label":"Q1","value":"A1"},
            {"label":"Q2","value":""}
        ])
    );
}

#[tokio::test]
async fn contact_fact_answers_merges_facts_and_variant_contact() {
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
    let contact = serde_json::to_string(&ContactInfo {
        phone: Some("555-0100".into()),
        website: Some("https://portfolio.test".into()),
        ..Default::default()
    })
    .unwrap();
    sqlx::query(
        "INSERT INTO profile_variants
             (id, profile_id, name, target_title, contact_json, created_at, updated_at)
             VALUES ('v1', 'p1', 'Base', 'Engineer', ?1, 'now', 'now')",
    )
    .bind(contact)
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO profile_facts
             (id, profile_id, fact_key, fact_value, source, updated_at)
             VALUES ('f1', 'p1', 'email', 'person@example.test', 'test', 'now')",
    )
    .execute(&db)
    .await
    .unwrap();

    let mut tx = db.begin().await.unwrap();
    let answers = contact_fact_answers(&mut tx, "p1", Some("v1"))
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(answers.iter().any(|value| {
        value["label"] == "email address" && value["value"] == "person@example.test"
    }));
    assert!(answers
        .iter()
        .any(|value| value["label"] == "phone" && value["value"] == "555-0100"));
    assert!(answers.iter().any(|value| {
        value["label"] == "portfolio" && value["value"] == "https://portfolio.test"
    }));

    let mut tx = db.begin().await.unwrap();
    let facts_only = contact_fact_answers(&mut tx, "p1", None).await.unwrap();
    tx.commit().await.unwrap();
    assert!(facts_only.iter().any(|value| value["label"] == "e-mail"));
}
