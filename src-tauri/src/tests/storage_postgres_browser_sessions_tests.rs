use super::*;

#[test]
fn row_conversion_preserves_metadata_without_state_blob() {
    let row = BrowserSessionRow {
        id: "session-1".into(),
        profile_id: "profile-1".into(),
        encryption_version: 1,
        state_format_version: 1,
        revision: 4,
        status: "valid".into(),
        encrypted_state_bytes: 1234,
        platform_status: sqlx::types::Json(serde_json::json!({"linkedin": "valid"})),
        created_at: "created".into(),
        updated_at: "updated".into(),
        last_validated_at: Some("validated".into()),
    };
    let metadata = BrowserSessionMetadata::from(row);
    assert_eq!(metadata.profile_id, "profile-1");
    assert_eq!(metadata.revision, 4);
    assert_eq!(metadata.encrypted_state_bytes, 1234);
    assert_eq!(metadata.platform_status["linkedin"], "valid");
    assert_eq!(metadata.last_validated_at.as_deref(), Some("validated"));
}

#[tokio::test]
async fn invalid_status_is_rejected_before_database_access() {
    let pool = PgPool::connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid").unwrap();
    let status = upsert_browser_session(
        &pool,
        BrowserSessionWrite {
            profile_id: "profile-1",
            encrypted_state: b"ciphertext",
            encryption_version: 1,
            state_format_version: 1,
            status: "not-a-status",
            platform_status: &serde_json::json!({}),
            expected_revision: None,
        },
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(status.contains("invalid browser session status"));
}

#[tokio::test]
async fn already_released_profile_lock_is_idempotent() {
    let lock = ProfileSessionLock {
        connection: None,
        profile_id: "profile-1".into(),
    };
    lock.release().await.unwrap();
}
