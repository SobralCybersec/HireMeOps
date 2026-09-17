use super::*;

#[tokio::test]
async fn new_driver_tracks_current_session_without_starting_worker() {
    let driver = PlaywrightDriver::new("/tmp/hiremeops-playwright-tests");
    assert!(driver.current_session().await.is_none());
    driver.remember_session("session-1").await;
    assert_eq!(driver.current_session().await.as_deref(), Some("session-1"));
    assert_eq!(driver.login_session_for("profile-1").await, None);
}
