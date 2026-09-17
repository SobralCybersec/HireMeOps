use super::{
    chat_cancel, chat_prompt, content_text, is_chat_cancelled, take_chat_cancelled, text_chunks,
    ChatModelMessage,
};
use serde_json::json;

#[test]
fn model_message_parts_become_prompt_text() {
    let message = ChatModelMessage {
        role: "user".into(),
        content: json!([
            {"type": "text", "text": " Find"},
            {"type": "text", "text": " roles "},
            {"type": "image", "image": "ignored"}
        ]),
    };

    assert_eq!(content_text(&message.content), " Find roles ");
    assert_eq!(chat_prompt(&[message]), "USER: Find roles");
}

#[test]
fn response_chunks_preserve_unicode_and_text() {
    let text = "one two 你好";
    let chunks = text_chunks(text, 4);

    assert_eq!(chunks.join(""), text);
    assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 5));
}

#[test]
fn content_text_handles_scalar_non_text_and_blank_messages() {
    assert_eq!(content_text(&json!("plain")), "plain");
    assert_eq!(content_text(&json!(null)), "");
    assert_eq!(
        content_text(&json!([
            {"type": "image", "text": "ignored"},
            {"type": "text", "text": "hello"},
            {"type": "text"}
        ])),
        "hello"
    );
    let messages = vec![
        ChatModelMessage {
            role: "user".into(),
            content: json!("  "),
        },
        ChatModelMessage {
            role: "assistant".into(),
            content: json!("answer"),
        },
    ];
    assert_eq!(chat_prompt(&messages), "ASSISTANT: answer");
}

#[test]
fn text_chunks_flushes_at_whitespace_and_keeps_trailing_text() {
    assert!(text_chunks("", 4).is_empty());
    assert_eq!(text_chunks("one two", 3), vec!["one ", "two"]);
    assert_eq!(text_chunks("one", 0), vec!["one"]);
    assert_eq!(text_chunks("你好 世界", 2), vec!["你好 ", "世界"]);
}

#[tokio::test]
async fn chat_cancellation_is_scoped_to_non_empty_run_ids() {
    let run_id = "quality-cancel-fixture";
    assert!(!is_chat_cancelled(run_id));
    chat_cancel("  ".into()).await;
    assert!(!is_chat_cancelled(run_id));
    chat_cancel(run_id.into()).await;
    assert!(is_chat_cancelled(run_id));
    assert!(take_chat_cancelled(run_id));
    assert!(!take_chat_cancelled(run_id));
}
