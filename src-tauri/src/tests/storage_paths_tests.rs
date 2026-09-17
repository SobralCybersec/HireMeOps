use super::*;

#[test]
fn automation_profile_dir_same_inputs_same_output() {
    let root = PathBuf::from("/data");
    let a = automation_profile_dir(&root, "profile-1");
    let b = automation_profile_dir(&root, "profile-1");
    let c = automation_profile_dir(&root, "profile-2");
    assert_eq!(a, b, "same inputs must produce identical paths");
    assert_ne!(a, c, "different profile_ids must produce different paths");
    assert_eq!(a, PathBuf::from("/data/profiles/profile-1/browser"));
}
