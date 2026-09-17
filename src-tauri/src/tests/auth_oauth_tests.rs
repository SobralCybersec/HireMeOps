use super::*;

#[test]
fn base64url_has_no_padding_and_is_urlsafe() {
    assert_eq!(base64url(b"sure."), "c3VyZS4");
    let enc = base64url(&[251, 255, 191]);
    assert!(!enc.contains('+') && !enc.contains('/') && !enc.contains('='));
}

#[test]
fn pkce_challenge_matches_known_vector() {
    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    assert_eq!(
        code_challenge(verifier),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

#[test]
fn verifier_is_43_chars_and_random() {
    let a = gen_random_b64();
    let b = gen_random_b64();
    assert_eq!(a.len(), 43, "32 bytes base64url-unpadded = 43 chars");
    assert_ne!(a, b);
}

#[test]
fn parse_redirect_handles_all_forms() {
    assert_eq!(parse_redirect("abc123"), Some(("abc123".into(), None)));
    assert_eq!(
        parse_redirect("  abc123#xyz "),
        Some(("abc123".into(), Some("xyz".into())))
    );
    assert_eq!(
        parse_redirect("http://localhost:1455/auth/callback?code=A%2FB&state=st#frag"),
        Some(("A/B".into(), Some("st".into())))
    );
    assert_eq!(
        parse_redirect("https://x/cb?foo=1&code=only"),
        Some(("only".into(), None))
    );
    assert_eq!(parse_redirect("   "), None);
    assert_eq!(parse_redirect("#state-only"), None);
}

#[test]
fn token_set_carries_forward_refresh_and_computes_expiry() {
    let resp = json!({ "access_token": "AT", "expires_in": 3600 });
    let ts = token_set_from_response(&resp, Some("OLD_RT".into()), 1_000).unwrap();
    assert_eq!(ts.access_token, "AT");
    assert_eq!(ts.refresh_token.as_deref(), Some("OLD_RT"));
    assert_eq!(ts.expires_at, Some(4_600));

    let resp2 = json!({ "access_token": "AT2", "refresh_token": "NEW_RT" });
    let ts2 = token_set_from_response(&resp2, Some("OLD_RT".into()), 0).unwrap();
    assert_eq!(ts2.refresh_token.as_deref(), Some("NEW_RT"));
    assert_eq!(ts2.expires_at, None);
}

#[test]
fn missing_access_token_is_an_error() {
    let resp = json!({ "token_type": "bearer" });
    assert!(token_set_from_response(&resp, None, 0).is_err());
}

#[test]
fn staleness_respects_skew_and_unknown_expiry() {
    let t = TokenSet {
        access_token: "x".into(),
        refresh_token: None,
        expires_at: Some(1_000),
    };
    assert!(!t.is_stale(900, 60), "far from expiry → fresh");
    assert!(t.is_stale(950, 60), "within skew → stale");
    assert!(t.is_stale(1_000, 0), "at expiry → stale");
    let unknown = TokenSet {
        access_token: "x".into(),
        refresh_token: None,
        expires_at: None,
    };
    assert!(unknown.is_stale(0, 0), "unknown expiry → stale");
}

#[test]
fn provider_table_covers_the_three_subscription_providers() {
    assert!(supports_oauth("anthropic"));
    assert!(supports_oauth("anthropic_compatible"));
    assert!(supports_oauth("openai"));
    assert!(!supports_oauth("ollama"));
}

#[test]
fn begin_builds_a_pkce_authorize_url_and_stashes_state() {
    let start = begin("anthropic").unwrap();
    assert!(start
        .authorize_url
        .starts_with("https://claude.ai/oauth/authorize?"));
    assert!(start.authorize_url.contains("code_challenge_method=S256"));
    assert!(start.authorize_url.contains("response_type=code"));
    assert!(
        start.authorize_url.contains("code=true"),
        "extra param present"
    );
    assert!(start
        .authorize_url
        .contains(&format!("state={}", start.state)));
    assert!(pending().lock().unwrap().contains_key(&start.state));
}

#[test]
fn begin_rejects_non_oauth_provider() {
    assert!(begin("ollama").is_err());
}

#[test]
fn parse_request_target_extracts_code_and_state() {
    assert_eq!(
        parse_request_target("/auth/callback?code=A%2FB&state=st"),
        Some(("A/B".into(), Some("st".into())))
    );
    assert_eq!(
        parse_request_target("/cb?code=only"),
        Some(("only".into(), None))
    );
    assert_eq!(
        parse_request_target("/cb?code=c&state=s#frag"),
        Some(("c".into(), Some("s".into())))
    );
    assert_eq!(parse_request_target("/favicon.ico"), None);
    assert_eq!(parse_request_target("/cb?state=only"), None);
    assert_eq!(parse_request_target("/"), None);
}

#[test]
fn loopback_port_only_matches_local_http_redirects() {
    let local = OAuthProviderConfig {
        redirect_uri: "http://localhost:1455/auth/callback",
        ..probe_cfg()
    };
    assert_eq!(local.loopback_port(), Some(1455));
    let ip = OAuthProviderConfig {
        redirect_uri: "http://127.0.0.1:8788/cb",
        ..probe_cfg()
    };
    assert_eq!(ip.loopback_port(), Some(8788));

    let hosted = OAuthProviderConfig {
        redirect_uri: "https://console.anthropic.com/oauth/code/callback",
        ..probe_cfg()
    };
    assert_eq!(hosted.loopback_port(), None);
    let remote = OAuthProviderConfig {
        redirect_uri: "http://example.com:80/cb",
        ..probe_cfg()
    };
    assert_eq!(remote.loopback_port(), None);
}

fn probe_cfg() -> OAuthProviderConfig {
    OAuthProviderConfig {
        kind: "test",
        authorize_url: "https://example.com/authorize",
        token_url: "https://example.com/token",
        client_id: "cid",
        client_secret: None,
        redirect_uri: "http://localhost:1/cb",
        scope: "openid",
        extra_authorize: &[],
        token_body_json: false,
        token_includes_state: false,
    }
}

#[test]
fn url_helpers_decode_forms_and_encode_reserved_bytes() {
    assert_eq!(url_decode("hello+world%21"), "hello world!");
    assert_eq!(url_decode("bad%zz%"), "bad%zz%");
    assert_eq!(percent_encode("a b/c?"), "a%20b%2Fc%3F");
    assert_eq!(percent_encode("safe-_.~"), "safe-_.~");
    assert!(provider_config("missing").is_none());
    assert_eq!(provider_config("openai").unwrap().kind, "openai");
}

#[test]
fn oauth_status_and_request_parameters_preserve_refresh_contract() {
    assert!(!status_from_tokens(None).connected);
    let tokens = TokenSet {
        access_token: "access".into(),
        refresh_token: Some("refresh".into()),
        expires_at: Some(42),
    };
    let status = status_from_tokens(Some(&tokens));
    assert!(status.connected);
    assert!(status.can_refresh);
    assert_eq!(status.expires_at, Some(42));

    let mut cfg = probe_cfg();
    cfg.client_secret = Some("secret");
    cfg.token_includes_state = true;
    let params =
        authorization_code_params(&cfg, "code".into(), "verifier".into(), Some("state".into()));
    assert!(params.contains(&("state", "state".into())));
    assert!(params.contains(&("client_secret", "secret".into())));
    let refresh = refresh_params(&cfg, "refresh");
    assert!(refresh.contains(&("refresh_token", "refresh".into())));
    assert!(refresh.contains(&("client_secret", "secret".into())));
}

#[test]
fn pending_verifier_requires_matching_provider_and_state() {
    let cfg = probe_cfg();
    let start = begin("anthropic").unwrap();
    assert!(take_pending_verifier(&cfg, Some("wrong-state")).is_err());
    assert!(take_pending_verifier(&cfg, Some(&start.state)).is_err());

    let start_again = begin("anthropic").unwrap();
    let matching_cfg = OAuthProviderConfig {
        kind: "anthropic",
        ..probe_cfg()
    };
    let verifier = take_pending_verifier(&matching_cfg, Some(&start_again.state)).unwrap();
    assert!(!verifier.is_empty());
    assert!(take_pending_verifier(&cfg, None).is_err());
}
