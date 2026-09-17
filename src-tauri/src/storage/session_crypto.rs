//! AEAD envelope for browser storage-state snapshots.
//!
//! Format v1: 12-byte AES-256-GCM nonce followed by ciphertext and its 16-byte tag.
//! The envelope version lives beside the blob in PostgreSQL so future rotations can
//! select a different decoder without trying to infer formats from secret bytes.

#[cfg(feature = "real-browser")]
use std::env;

#[cfg(test)]
use anyhow::bail;
#[cfg(any(test, feature = "real-browser"))]
use anyhow::{Context, Result};
#[cfg(any(test, feature = "real-browser"))]
use base64::{engine::general_purpose, Engine as _};
#[cfg(test)]
use ring::aead;
#[cfg(any(test, feature = "real-browser"))]
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
#[cfg(any(test, feature = "real-browser"))]
use ring::rand::{SecureRandom, SystemRandom};
#[cfg(any(test, feature = "real-browser"))]
use serde_json::Value;

#[cfg(feature = "real-browser")]
pub const ENCRYPTION_VERSION: i32 = 1;
#[cfg(any(test, feature = "real-browser"))]
const NONCE_LEN: usize = 12;

#[cfg(feature = "real-browser")]
pub fn encrypt_json(state: &Value) -> Result<Vec<u8>> {
    let key = key_from_env()?;
    encrypt_json_with_key(state, &key)
}

#[cfg(any(test, feature = "real-browser"))]
fn encrypt_json_with_key(state: &Value, key: &[u8; 32]) -> Result<Vec<u8>> {
    let mut plaintext = serde_json::to_vec(state).context("serialize storage state")?;
    let mut nonce = [0u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| anyhow::anyhow!("generate storage-state nonce"))?;
    let sealing_key = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key)
            .map_err(|_| anyhow::anyhow!("invalid storage-state encryption key"))?,
    );
    sealing_key
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::empty(),
            &mut plaintext,
        )
        .map_err(|_| anyhow::anyhow!("encrypt storage state"))?;
    let mut envelope = nonce.to_vec();
    envelope.extend_from_slice(&plaintext);
    Ok(envelope)
}

#[cfg(test)]
fn decrypt_json_with_key(ciphertext: &[u8], key: &[u8; 32]) -> Result<Value> {
    if ciphertext.len() <= NONCE_LEN + aead::AES_256_GCM.tag_len() {
        bail!("encrypted storage state is truncated")
    }
    let nonce: [u8; NONCE_LEN] = ciphertext[..NONCE_LEN]
        .try_into()
        .map_err(|_| anyhow::anyhow!("invalid storage-state nonce"))?;
    let mut plaintext = ciphertext[NONCE_LEN..].to_vec();
    let opening_key = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key)
            .map_err(|_| anyhow::anyhow!("invalid storage-state encryption key"))?,
    );
    let plaintext = opening_key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::empty(),
            &mut plaintext,
        )
        .map_err(|_| anyhow::anyhow!("decrypt storage state"))?;
    serde_json::from_slice(plaintext).context("parse decrypted storage state")
}

#[cfg(feature = "real-browser")]
fn key_from_env() -> Result<[u8; 32]> {
    let encoded = env::var("HIREMEOPS_SESSION_ENCRYPTION_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .context("HIREMEOPS_SESSION_ENCRYPTION_KEY is required")?;
    decode_key(&encoded)
}

#[cfg(any(test, feature = "real-browser"))]
fn decode_key(encoded: &str) -> Result<[u8; 32]> {
    let value = encoded.trim();
    let bytes = if let Some(hex_value) = value.strip_prefix("hex:") {
        hex::decode(hex_value).context("decode storage-state key")?
    } else if let Some(base64_value) = value.strip_prefix("base64:") {
        general_purpose::STANDARD
            .decode(base64_value)
            .context("decode storage-state key")?
    } else if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        hex::decode(value).context("decode storage-state key")?
    } else {
        general_purpose::STANDARD
            .decode(value)
            .context("decode storage-state key")?
    };
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("storage-state key must decode to 32 bytes"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const KEY: [u8; 32] = [7; 32];

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
}
