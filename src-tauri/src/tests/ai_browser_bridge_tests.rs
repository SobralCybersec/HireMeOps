use super::*;

/// The registry half of the warm-up fix: `status()` walks the registry, so
/// an unregistered site left the settings panel blank until the first login.
/// Points the helper at an empty dir — the Node spawn is allowed to fail
/// here; registration must happen either way.
#[tokio::test]
async fn warm_up_registers_every_known_site() {
    let tmp = std::env::temp_dir().join("hiremeops-bridge-warmup-test");
    let _ = std::fs::create_dir_all(&tmp);
    std::env::set_var("HIREMEOPS_BROWSER_BRIDGE_DIR", &tmp);

    warm_up().await;

    let map = registry().lock().await;
    for site in BROWSER_SITES {
        assert!(map.contains_key(*site), "warm_up did not register {site}");
    }
}

#[test]
fn browser_model_list_preserves_order() {
    let list: BrowserModelList = serde_json::from_value(json!({
        "data": [
            { "id": "gpt-4o", "provider": "chatgpt" },
            { "id": "gpt-4o-mini", "provider": "chatgpt" },
            { "id": "o1", "provider": "chatgpt" },
        ]
    }))
    .expect("valid list_models payload");
    let ids: Vec<String> = list.data.into_iter().map(|m| m.id).collect();
    assert_eq!(ids, vec!["gpt-4o", "gpt-4o-mini", "o1"]);
}

#[test]
fn browser_model_list_single_fallback() {
    let list: BrowserModelList = serde_json::from_str(
        r#"{ "data": [ { "id": "chatgpt-web-session", "provider": "chatgpt" } ] }"#,
    )
    .expect("valid fallback payload");
    let ids: Vec<String> = list.data.into_iter().map(|m| m.id).collect();
    assert_eq!(ids, vec!["chatgpt-web-session"]);
}

#[test]
fn browser_model_list_empty_data() {
    let list: BrowserModelList =
        serde_json::from_value(json!({ "data": [] })).expect("valid empty payload");
    let ids: Vec<String> = list.data.into_iter().map(|m| m.id).collect();
    assert!(ids.is_empty());
}
