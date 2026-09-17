use super::*;

#[test]
fn status_summary_prioritizes_challenge_and_validity() {
    assert_eq!(
        summarize_status(&json!({ "site": "challenged" })),
        "challenged"
    );
    assert_eq!(
        summarize_status(&json!({ "site": "valid", "other": "login_required" })),
        "valid"
    );
    assert_eq!(
        summarize_status(&json!({ "site": "login_required" })),
        "login_required"
    );
    assert_eq!(summarize_status(&json!({})), "unknown");
}

#[test]
fn session_bridge_ignores_infojobs_login_status() {
    let reply = json!({
        "platform_status": {
            "linkedin": "valid",
            "infojobs": "login_required"
        }
    });
    let filtered = platform_status(reply.as_object().unwrap());
    assert_eq!(filtered, json!({ "linkedin": "valid" }));
    assert_eq!(summarize_status(&filtered), "valid");
}

#[test]
fn cloud_trigger_checks_requested_platform_status() {
    let statuses = json!({
        "linkedin": "valid",
        "gupy": "login_required"
    });
    assert_eq!(
        target_session_status("valid", &statuses, Some("linkedin")),
        "valid"
    );
    assert_eq!(
        target_session_status("valid", &statuses, Some("gupy")),
        "login_required"
    );
    assert_eq!(
        target_session_status("valid", &statuses, Some("indeed")),
        "unknown"
    );
    assert_eq!(
        target_session_status("valid", &statuses, Some("linkedin_posts")),
        "valid"
    );
    assert_eq!(
        target_session_status("valid", &statuses, Some("google")),
        "valid"
    );
}

fn valid_cloud_session() -> BrowserSessionMetadata {
    BrowserSessionMetadata {
        id: "session-fixture".to_owned(),
        profile_id: "default".to_owned(),
        encryption_version: crate::storage::session_crypto::ENCRYPTION_VERSION,
        state_format_version: STORAGE_STATE_VERSION,
        revision: 8,
        status: "valid".to_owned(),
        encrypted_state_bytes: 201_625,
        platform_status: json!({ "linkedin": "valid" }),
        created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-01-01T00:00:00.000Z".to_owned(),
        last_validated_at: None,
    }
}

#[test]
fn cloud_session_preflight_requires_real_profile_and_ciphertext() {
    let session = valid_cloud_session();
    assert_eq!(
        validate_cloud_session(&session, " ", Some("linkedin")),
        Err("profile_id is required".to_owned())
    );

    let mut empty = session.clone();
    empty.encrypted_state_bytes = 0;
    assert_eq!(
        validate_cloud_session(&empty, "default", Some("linkedin")),
        Err("cloud browser session has no encrypted state".to_owned())
    );

    assert_eq!(
        validate_cloud_session(&session, "work", Some("linkedin")),
        Err("cloud browser session profile mismatch".to_owned())
    );
}

#[test]
fn cloud_session_preflight_requires_supported_versions_and_target_status() {
    let session = valid_cloud_session();
    let mut wrong_encryption = session.clone();
    wrong_encryption.encryption_version = 99;
    assert!(
        validate_cloud_session(&wrong_encryption, "default", Some("linkedin"))
            .unwrap_err()
            .contains("unsupported session encryption version")
    );

    let mut wrong_state = session.clone();
    wrong_state.state_format_version = 99;
    assert!(
        validate_cloud_session(&wrong_state, "default", Some("linkedin"))
            .unwrap_err()
            .contains("unsupported storage state version")
    );

    let mut challenged = session;
    challenged.platform_status = json!({ "linkedin": "challenged" });
    assert_eq!(
        validate_cloud_session(&challenged, "default", Some("linkedin")),
        Err("cloud browser session is not valid for linkedin: challenged".to_owned())
    );
}

#[test]
fn cloud_run_receipt_includes_profile_and_session_revision() {
    let value = serde_json::to_value(CloudRunReceipt {
        profile_id: "default".to_owned(),
        session_revision: 8,
        search_run_id: "search-fixture".to_owned(),
        northflank_run_id: "run-fixture".to_owned(),
        northflank_run_name: "hiremeops-fixture".to_owned(),
    })
    .unwrap();
    assert_eq!(value["profileId"], "default");
    assert_eq!(value["sessionRevision"], 8);
}

#[test]
fn profile_and_platform_helpers_reject_empty_or_malformed_input() {
    assert_eq!(
        validated_profile_id("  "),
        Err("profile_id is required".into())
    );
    assert_eq!(validated_profile_id(" profile-1 "), Ok("profile-1"));
    assert_eq!(platform_status(&serde_json::Map::new()), json!({}));
    assert_eq!(summarize_status(&json!({"site": "expired"})), "unknown");
    assert_eq!(
        target_session_status("valid", &json!({}), Some("unsupported")),
        "valid"
    );
}

#[test]
fn northflank_environment_validation_requires_https_and_secrets() {
    assert_eq!(
        required_env("HIREMEOPS_MISSING_TEST"),
        Err("HIREMEOPS_MISSING_TEST is required".into())
    );
    let mut config = NorthflankConfig {
        token: "token".into(),
        project_id: "project".into(),
        job_id: "job".into(),
        base_url: "http://localhost".into(),
    };
    assert!(!config.base_url.starts_with("https://"));
    config.base_url = "https://example.test/v1/".into();
    assert_eq!(
        config.base_url.trim_end_matches('/'),
        "https://example.test/v1"
    );
}
