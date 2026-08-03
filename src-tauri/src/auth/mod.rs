//! Authentication for AI providers beyond a raw API key.
//! Key: oauth — subscription OAuth 2.0 + PKCE login (Claude Pro/Max, ChatGPT); tokens in the OS keyring

pub mod oauth;
