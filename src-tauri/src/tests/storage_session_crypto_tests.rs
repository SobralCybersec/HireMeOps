use super::*;
#[cfg(feature = "real-browser")]
use std::sync::Mutex;

const KEY: [u8; 32] = [7; 32];

#[cfg(feature = "real-browser")]
static ENV_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn encryption_roundtrip() {
    let state = serde_json::json!({
        "cookies": [{ "name": "synthetic", "value": "fixture" }],
        "origins": [{ "origin": "https://fixture.invalid", "localStorage": [] }]
    });
    let encrypted = encrypt_json_with_key(&state, &KEY).unwrap();
    assert_ne!(encrypted, serde_json::to_vec(&state).unwrap());
    assert_eq!(decrypt_json_with_key(&encrypted, &KEY).unwrap(), state);
}

#[test]
fn corrupted_ciphertext_is_rejected() {
    let encrypted = encrypt_json_with_key(&serde_json::json!({ "ok": true }), &KEY).unwrap();
    let mut corrupted = encrypted.clone();
    corrupted[NONCE_LEN + 1] ^= 1;
    assert!(decrypt_json_with_key(&corrupted, &KEY).is_err());
}

#[test]
fn wrong_key_is_rejected() {
    let encrypted = encrypt_json_with_key(&serde_json::json!({ "ok": true }), &KEY).unwrap();
    assert!(decrypt_json_with_key(&encrypted, &[8; 32]).is_err());
}

#[test]
fn key_decoder_accepts_documented_encodings() {
    assert_eq!(
        decode_key(&format!("hex:{}", "07".repeat(32))).unwrap(),
        KEY
    );
    assert_eq!(
        decode_key(&format!("base64:{}", general_purpose::STANDARD.encode(KEY))).unwrap(),
        KEY
    );
    assert_eq!(decode_key(&"07".repeat(32)).unwrap(), KEY);
    assert_eq!(
        decode_key(&general_purpose::STANDARD.encode(KEY)).unwrap(),
        KEY
    );
}

#[test]
fn key_decoder_rejects_invalid_and_wrong_length_keys() {
    assert!(decode_key("not-a-key").is_err());
    assert!(decode_key(&"07".repeat(31)).is_err());
}

#[test]
fn decrypt_rejects_truncated_envelope() {
    assert!(decrypt_json_with_key(&[0; NONCE_LEN + 16], &KEY).is_err());
}

#[cfg(feature = "real-browser")]
#[test]
fn encryption_reads_key_from_environment() {
    let _guard = ENV_LOCK.lock().unwrap();
    let previous = env::var("HIREMEOPS_SESSION_ENCRYPTION_KEY").ok();
    env::set_var(
        "HIREMEOPS_SESSION_ENCRYPTION_KEY",
        format!("hex:{}", "07".repeat(32)),
    );
    let encrypted = encrypt_json(&serde_json::json!({ "source": "env" })).unwrap();
    match previous {
        Some(value) => env::set_var("HIREMEOPS_SESSION_ENCRYPTION_KEY", value),
        None => env::remove_var("HIREMEOPS_SESSION_ENCRYPTION_KEY"),
    }
    assert_eq!(
        decrypt_json_with_key(&encrypted, &KEY).unwrap()["source"],
        "env"
    );
}

#[cfg(feature = "real-browser")]
#[test]
fn encryption_requires_environment_key() {
    let _guard = ENV_LOCK.lock().unwrap();
    let previous = env::var("HIREMEOPS_SESSION_ENCRYPTION_KEY").ok();
    env::remove_var("HIREMEOPS_SESSION_ENCRYPTION_KEY");
    let result = key_from_env();
    match previous {
        Some(value) => env::set_var("HIREMEOPS_SESSION_ENCRYPTION_KEY", value),
        None => env::remove_var("HIREMEOPS_SESSION_ENCRYPTION_KEY"),
    }
    assert!(result.is_err());
}

#[cfg(feature = "real-browser")]
#[test]
fn encryption_rejects_empty_environment_key() {
    let _guard = ENV_LOCK.lock().unwrap();
    let previous = env::var("HIREMEOPS_SESSION_ENCRYPTION_KEY").ok();
    env::set_var("HIREMEOPS_SESSION_ENCRYPTION_KEY", "  ");
    let result = key_from_env();
    match previous {
        Some(value) => env::set_var("HIREMEOPS_SESSION_ENCRYPTION_KEY", value),
        None => env::remove_var("HIREMEOPS_SESSION_ENCRYPTION_KEY"),
    }
    assert!(result.is_err());
}

#[cfg(feature = "real-browser")]
#[test]
fn encryption_restores_existing_environment_key() {
    let _guard = ENV_LOCK.lock().unwrap();
    let previous = env::var("HIREMEOPS_SESSION_ENCRYPTION_KEY").ok();
    env::set_var(
        "HIREMEOPS_SESSION_ENCRYPTION_KEY",
        format!("hex:{}", "07".repeat(32)),
    );
    let encrypted = encrypt_json(&serde_json::json!({ "source": "existing-env" })).unwrap();
    match previous {
        Some(value) => env::set_var("HIREMEOPS_SESSION_ENCRYPTION_KEY", value),
        None => env::remove_var("HIREMEOPS_SESSION_ENCRYPTION_KEY"),
    }
    assert_eq!(
        decrypt_json_with_key(&encrypted, &KEY).unwrap()["source"],
        "existing-env"
    );
}
