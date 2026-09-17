use super::*;

#[test]
fn hash_matches_known_sha256() {
    assert_eq!(
        hash_bytes(b"hello"),
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
}

#[test]
fn hash_differs_by_content() {
    assert_ne!(hash_bytes(b"a"), hash_bytes(b"b"));
}
