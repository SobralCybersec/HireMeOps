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
#[path = "../tests/storage_session_crypto_tests.rs"]
mod tests;
