use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::collections::HashMap;
use std::str::FromStr;
use tauri::Manager;

async fn database() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
         VALUES ('p1', 'Primary', 'now', 'now', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

#[tokio::test]
async fn profile_commands_cover_crud_and_fact_cleanup() {
    let app = crate::test_support::app_with_db(database().await);
    let state = app.state::<crate::AppState>();

    let profiles = list_profiles(state.clone()).await.unwrap();
    assert_eq!(profiles.len(), 2);
    assert!(profiles
        .iter()
        .any(|profile| profile.id == "p1" && profile.is_active));

    assert_eq!(
        create_profile(state.clone(), "   ".into())
            .await
            .unwrap_err(),
        "Profile name is required"
    );
    let created = create_profile(state.clone(), "  Secondary  ".into())
        .await
        .unwrap();
    assert_eq!(created.name, "Secondary");
    assert!(!created.is_active);

    assert_eq!(
        rename_profile(state.clone(), "p1".into(), " ".into())
            .await
            .unwrap_err(),
        "Profile name is required"
    );
    assert_eq!(
        rename_profile(state.clone(), "missing".into(), "Other".into())
            .await
            .unwrap_err(),
        "Profile not found"
    );
    rename_profile(state.clone(), created.id.clone(), " Renamed ".into())
        .await
        .unwrap();
    assert!(list_profiles(state.clone())
        .await
        .unwrap()
        .iter()
        .any(|p| p.name == "Renamed"));

    let facts = HashMap::from([
        ("name".to_string(), "Candidate".to_string()),
        ("email".to_string(), "candidate@example.test".to_string()),
        ("blank".to_string(), "  ".to_string()),
    ]);
    save_profile_facts(state.clone(), "p1".into(), facts)
        .await
        .unwrap();
    let loaded = get_profile_facts(state.clone(), "p1".into()).await.unwrap();
    assert_eq!(loaded.get("name").map(String::as_str), Some("Candidate"));
    assert_eq!(
        loaded.get("email").map(String::as_str),
        Some("candidate@example.test")
    );
    assert!(!loaded.contains_key("blank"));

    save_profile_facts(
        state.clone(),
        "p1".into(),
        HashMap::from([("name".to_string(), String::new())]),
    )
    .await
    .unwrap();
    assert!(!get_profile_facts(state, "p1".into())
        .await
        .unwrap()
        .contains_key("name"));
}
