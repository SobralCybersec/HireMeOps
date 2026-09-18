use super::event_kind;
use crate::events::AppEventType;

#[test]
fn maps_durable_realtime_events_to_wire_events() {
    assert_eq!(
        event_kind("job.search.started"),
        Some(AppEventType::JobSearchStarted)
    );
    assert_eq!(
        event_kind("job.search.item_found"),
        Some(AppEventType::JobSearchItemFound)
    );
    assert_eq!(
        event_kind("browser.session.status"),
        Some(AppEventType::BrowserSessionStatus)
    );
    assert_eq!(event_kind("unknown"), None);
}
