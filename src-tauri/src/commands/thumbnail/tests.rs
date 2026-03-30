use std::path::Path;

use super::{compute_fallback_key, thumbnail_output_path, ThumbnailBucket};

#[test]
fn thumbnail_bucket_from_size_hint_uses_expected_buckets() {
    assert_eq!(ThumbnailBucket::from_size_hint(None), ThumbnailBucket::Px64);
    assert_eq!(
        ThumbnailBucket::from_size_hint(Some(16)),
        ThumbnailBucket::Px64
    );
    assert_eq!(
        ThumbnailBucket::from_size_hint(Some(64)),
        ThumbnailBucket::Px64
    );
    assert_eq!(
        ThumbnailBucket::from_size_hint(Some(65)),
        ThumbnailBucket::Px256
    );
    assert_eq!(
        ThumbnailBucket::from_size_hint(Some(512)),
        ThumbnailBucket::Px256
    );
}

#[test]
fn fallback_key_is_stable_for_same_input() {
    let key_a = compute_fallback_key(r"C:\a.png", ThumbnailBucket::Px64);
    let key_b = compute_fallback_key(r"C:\a.png", ThumbnailBucket::Px64);
    let key_c = compute_fallback_key(r"C:\a.png", ThumbnailBucket::Px256);

    assert_eq!(key_a, key_b);
    assert_ne!(key_a, key_c);
    assert_eq!(key_a.len(), 64);
}

#[test]
fn thumbnail_output_path_groups_by_bucket_and_hash_prefix() {
    let cache_root = Path::new(r"C:\cache");
    let key = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    let output = thumbnail_output_path(cache_root, ThumbnailBucket::Px256, key);
    let components = output
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();

    assert!(components
        .windows(3)
        .any(|window| window == ["256", "ab", "cd"]));
    assert!(output.ends_with(format!("{key}.webp")));
}
