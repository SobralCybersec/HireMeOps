use super::*;

#[test]
fn ids_preserve_wire_string_and_display_value() {
    let job = JobId::from("job-1");
    let profile = ProfileId::from(String::from("profile-1"));
    assert_eq!(job.as_str(), "job-1");
    assert_eq!(profile.as_str(), "profile-1");
    assert_eq!(job.to_string(), "job-1");
    assert_eq!(profile.to_string(), "profile-1");
    assert_eq!(serde_json::to_string(&job).unwrap(), "\"job-1\"");
    assert_eq!(
        serde_json::from_str::<ProfileId>("\"profile-1\"").unwrap(),
        profile
    );
}
