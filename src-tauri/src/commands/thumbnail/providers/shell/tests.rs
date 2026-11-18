use super::{bgra_to_rgba, without_verbatim_prefix, ShellThumbnailProvider};
use crate::commands::thumbnail::providers::{
  ThumbnailGenerateOutcome, ThumbnailJobInput, ThumbnailJobOutput, ThumbnailProvider,
};
use crate::commands::thumbnail::types::ThumbnailBucket;
use image::{GenericImageView, ImageBuffer, Rgba};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

fn unique_test_root(prefix: &str) -> PathBuf {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("clock should be monotonic")
    .as_nanos();
  let root = env::temp_dir().join(format!("{prefix}-{timestamp}"));
  fs::create_dir_all(&root).expect("test root should be created");
  root
}

fn generate(source_path: &Path, output_path: &Path) -> ThumbnailGenerateOutcome {
  ShellThumbnailProvider
    .generate(
      ThumbnailJobInput {
        source_path,
        bucket: ThumbnailBucket::Px64,
      },
      ThumbnailJobOutput {
        temp_output_path: output_path,
      },
    )
    .expect("the shell should answer")
}

#[test]
fn strips_verbatim_prefixes_for_the_shell() {
  assert_eq!(without_verbatim_prefix(Path::new(r"\\?\C:\videos\a.mp4")), r"C:\videos\a.mp4");
  assert_eq!(
    without_verbatim_prefix(Path::new(r"\\?\UNC\server\share\a.mp4")),
    r"\\server\share\a.mp4",
  );
  assert_eq!(without_verbatim_prefix(Path::new(r"C:\videos\a.mp4")), r"C:\videos\a.mp4");
}

#[test]
fn converts_premultiplied_bgra_to_rgba() {
  let mut pixels = vec![10, 20, 30, 255, 0, 0, 64, 128, 0, 0, 0, 0];
  bgra_to_rgba(&mut pixels);
  assert_eq!(pixels, vec![30, 20, 10, 255, 128, 0, 0, 128, 0, 0, 0, 0]);
}

#[test]
fn treats_bitmaps_without_any_alpha_as_opaque() {
  let mut pixels = vec![10, 20, 30, 0, 40, 50, 60, 0];
  bgra_to_rgba(&mut pixels);
  assert_eq!(pixels, vec![30, 20, 10, 255, 60, 50, 40, 255]);
}

#[test]
fn writes_a_webp_thumbnail_windows_made() {
  let root = unique_test_root("grayspace-shell-thumbnail");
  let source_path = root.join("wide.png");
  ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(200, 100, Rgba([20, 40, 60, 255]))
    .save(&source_path)
    .expect("source image should be written");
  let output_path = root.join("thumbnail.webp");

  // Canonical paths are `\\?\` paths, like the ones the thumbnail queue passes in.
  let canonical_source_path = fs::canonicalize(&source_path).expect("source should exist");
  assert!(matches!(
    generate(&canonical_source_path, &output_path),
    ThumbnailGenerateOutcome::Ready
  ));
  let (width, height) = image::open(&output_path)
    .expect("thumbnail should be a readable image")
    .dimensions();
  assert!(width <= 64 && height <= 64 && width > height, "got {width}x{height}");

  let _ = fs::remove_dir_all(root);
}

#[test]
fn reports_files_without_a_windows_thumbnail_as_unsupported() {
  let root = unique_test_root("grayspace-shell-thumbnail-none");
  let source_path = root.join("notes.grayspace-no-thumbnail");
  fs::write(&source_path, "plain text").expect("source should be written");

  assert!(matches!(
    generate(&source_path, &root.join("thumbnail.webp")),
    ThumbnailGenerateOutcome::Unsupported { .. }
  ));

  let _ = fs::remove_dir_all(root);
}
