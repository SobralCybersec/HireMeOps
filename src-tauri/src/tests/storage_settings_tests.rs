use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

async fn mem_pool() -> SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn paths() -> AppPaths {
    AppPaths {
        data_dir: "/tmp/hiremeops-test".into(),
        db_path: "/tmp/hiremeops-test/hiremeops.sqlite3".into(),
        evidence_dir: "/tmp/hiremeops-test/evidence".into(),
        export_dir: "/tmp/hiremeops-test/exports".into(),
        cv_files_dir: "/tmp/hiremeops-test/cv_files".into(),
        portable: false,
    }
}

#[tokio::test]
async fn defaults_are_idempotent_and_load_into_typed_settings() {
    let pool = mem_pool().await;

    ensure_defaults(&pool).await.unwrap();
    ensure_defaults(&pool).await.unwrap();

    let settings = load(&pool, &paths()).await.unwrap();
    assert_eq!(settings.active_profile_id.as_deref(), Some("default"));
    assert_eq!(settings.app_language, "en");
    assert_eq!(settings.startup_behavior, "normal");
    assert!(!settings.portable_mode);
    assert_eq!(settings.theme, "system");
    assert_eq!(settings.reduced_effects, "auto");
    assert!(settings.ai_providers.is_empty());
    assert_eq!(settings.default_ai_provider_index, 0);
    assert!(settings.browser_extensions.is_empty());
    assert!(settings.automation_headless);
    assert!(settings.automation_headless_overrides.is_empty());
    assert!(settings.ai_auto_init);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM app_settings")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, DEFAULTS.len() as i64);
}

#[tokio::test]
async fn save_roundtrips_values_and_runtime_switches() {
    let pool = mem_pool().await;
    ensure_defaults(&pool).await.unwrap();
    let settings = AppSettings {
        active_profile_id: Some("profile-a".into()),
        app_language: "pt".into(),
        startup_behavior: "minimized".into(),
        portable_mode: false,
        theme: "dark".into(),
        reduced_effects: "always".into(),
        ai_providers: vec![AiProviderSettings {
            kind: "openai".into(),
            label: "Test provider".into(),
            endpoint_url: "https://example.test".into(),
            api_key_stored: true,
            default_model: "model-a".into(),
            auth_kind: "api_key".into(),
        }],
        default_ai_provider_index: 1,
        browser_profile_root_path: "/profiles".into(),
        database_path: "/db".into(),
        audit_log_retention_days: 14,
        automation_evidence_retention_days: 3,
        browser_extensions: vec!["extension-a".into()],
        automation_headless: false,
        automation_headless_overrides: [("linkedin".into(), true)].into_iter().collect(),
        ai_auto_init: false,
    };

    save(&pool, &settings).await.unwrap();
    let loaded = load(&pool, &paths()).await.unwrap();
    assert_eq!(loaded.active_profile_id.as_deref(), Some("profile-a"));
    assert_eq!(loaded.app_language, "pt");
    assert_eq!(loaded.theme, "dark");
    assert_eq!(loaded.ai_providers[0].default_model, "model-a");
    assert_eq!(loaded.default_ai_provider_index, 1);
    assert_eq!(loaded.browser_extensions, vec!["extension-a"]);
    assert!(!loaded.automation_headless);
    assert!(loaded.automation_headless_overrides["linkedin"]);
    assert!(!loaded.ai_auto_init);

    assert!(!docker_worker_opt_in(&pool).await.unwrap());
    set_docker_worker_opt_in(&pool, true).await.unwrap();
    assert!(docker_worker_opt_in(&pool).await.unwrap());
    set_docker_worker_opt_in(&pool, false).await.unwrap();
    assert!(!docker_worker_opt_in(&pool).await.unwrap());

    assert!(!read_automation_headless(&pool).await);
    assert!(read_automation_headless_for(&pool, "linkedin", false).await);
    assert!(!read_automation_headless_for(&pool, "missing", false).await);
    assert!(!read_ai_auto_init(&pool).await);
    assert_eq!(
        read_active_profile_id(&pool).await.as_deref(),
        Some("profile-a")
    );
    let (providers, index) = load_ai_providers(&pool).await.unwrap();
    assert_eq!(providers.len(), 1);
    assert_eq!(index, 1);
}

#[tokio::test]
async fn invalid_stored_values_use_documented_fallbacks() {
    let pool = mem_pool().await;
    ensure_defaults(&pool).await.unwrap();
    for (key, value) in [
        ("active_profile_id", "   "),
        ("default_ai_provider_index", "not-a-number"),
        ("audit_log_retention_days", "not-a-number"),
        ("automation_evidence_retention_days", "not-a-number"),
        ("automation_headless", "not-a-bool"),
        ("automation_headless_overrides", "not-json"),
        ("ai_auto_init", "not-a-bool"),
        ("ai_providers", "not-json"),
        ("browser_extensions", "not-json"),
    ] {
        set(&pool, key, value).await.unwrap();
    }

    let loaded = load(&pool, &paths()).await.unwrap();
    assert_eq!(loaded.active_profile_id.as_deref(), Some("   "));
    assert_eq!(loaded.default_ai_provider_index, 0);
    assert_eq!(loaded.audit_log_retention_days, 30);
    assert_eq!(loaded.automation_evidence_retention_days, 1);
    assert!(loaded.automation_headless);
    assert!(loaded.automation_headless_overrides.is_empty());
    assert!(loaded.ai_auto_init);
    assert!(loaded.ai_providers.is_empty());
    assert!(loaded.browser_extensions.is_empty());
    assert!(!read_automation_headless_for(&pool, "linkedin", false).await);
    assert!(read_ai_auto_init(&pool).await);
    assert!(read_active_profile_id(&pool).await.is_none());
}
