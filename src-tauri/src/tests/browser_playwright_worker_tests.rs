use super::*;
use std::path::PathBuf;

#[tokio::test]
async fn event_router_forwards_frames_and_progress() {
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::unbounded_channel();
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();
    let frames = Arc::new(std::sync::Mutex::new(Some(frame_tx)));
    let progress = Arc::new(std::sync::Mutex::new(Some(progress_tx)));

    assert!(route_event(
        &serde_json::json!({
            "event": "screencast_frame",
            "data": "jpeg",
            "width": 800,
            "height": 600
        }),
        &frames,
        &progress
    ));
    let frame = frame_rx.recv().await.unwrap();
    assert_eq!(
        (frame.data, frame.width, frame.height),
        ("jpeg".into(), 800, 600)
    );

    assert!(route_event(
        &serde_json::json!({"event": "auto_connect_progress", "sent": 3, "status": "ok"}),
        &frames,
        &progress
    ));
    let tick = progress_rx.recv().await.unwrap();
    assert_eq!(tick.sent, 3);
    assert_eq!(tick.status, "ok");
    assert!(!route_event(
        &serde_json::json!({"id": "reply"}),
        &frames,
        &progress
    ));
}

#[tokio::test]
async fn reply_router_resolves_matching_pending_request() {
    let pending: PendingMap = Arc::new(std::sync::Mutex::new(HashMap::new()));
    let (tx, rx) = oneshot::channel();
    pending.lock().unwrap().insert("request-1".into(), tx);
    route_reply(
        serde_json::json!({"id": "request-1", "ok": true, "value": 7}),
        &pending,
    );
    let reply = rx.await.unwrap();
    assert!(reply.ok);
    assert_eq!(reply.data["value"], 7);
    assert!(pending.lock().unwrap().is_empty());
    route_reply(serde_json::json!({"not": "a reply"}), &pending);
}

#[test]
fn worker_command_builder_keeps_host_and_docker_modes_distinct() {
    let script = PathBuf::from("automation/worker.js");
    let profiles = PathBuf::from("/profiles");
    let host = build_worker_command(&script, &profiles, false);
    assert_eq!(host.as_std().get_program(), "node");
    assert_eq!(
        host.as_std().get_args().collect::<Vec<_>>(),
        vec!["automation/worker.js"]
    );

    let docker = build_worker_command(&script, &profiles, true);
    assert_eq!(docker.as_std().get_program(), "docker");
    let args = docker
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-v" && pair[1] == "/profiles:/profiles"));
    assert_eq!(
        args.last().map(String::as_str),
        Some(crate::commands::docker::WORKER_IMAGE)
    );
}
