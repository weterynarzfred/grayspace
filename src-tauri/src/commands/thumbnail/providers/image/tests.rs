use super::ImageThumbnailProvider;
use crate::commands::thumbnail::providers::{
  ThumbnailGenerateOutcome, ThumbnailJobInput, ThumbnailJobOutput, ThumbnailProvider,
};
use crate::commands::thumbnail::types::ThumbnailBucket;
use image::{ImageBuffer, Rgba};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

fn unique_test_root(prefix: &str) -> PathBuf {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("clock should be monotonic")
    .as_nanos();
  env::temp_dir().join(format!("{prefix}-{timestamp}"))
}

fn write_png(path: &Path, width: u32, height: u32) {
  let mut image =
    ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(width, height, Rgba([20, 40, 60, 255]));
  if width > 1 && height > 1 {
    image.put_pixel(width - 1, height - 1, Rgba([200, 180, 160, 255]));
  }
  image
    .save(path)
    .expect("source image should be written");
}

#[test]
fn supports_checks_extensions_case_insensitively() {
  let provider = ImageThumbnailProvider;

  assert!(provider.supports(Path::new(r"C:\images\photo.JPG")));
  assert!(provider.supports(Path::new(r"C:\images\icon.IcO")));
  assert!(!provider.supports(Path::new(r"C:\images\document.txt")));
  assert!(!provider.supports(Path::new(r"C:\images\noextension")));
}

#[test]
fn fit_inside_bucket_preserves_aspect_ratio_without_upscaling() {
  assert_eq!(
    ImageThumbnailProvider::fit_inside_bucket(0, 42, 64),
    (1, 1)
  );
  assert_eq!(
    ImageThumbnailProvider::fit_inside_bucket(120, 60, 256),
    (120, 60)
  );
  assert_eq!(
    ImageThumbnailProvider::fit_inside_bucket(300, 150, 64),
    (64, 32)
  );
  assert_eq!(
    ImageThumbnailProvider::fit_inside_bucket(150, 300, 64),
    (32, 64)
  );
}

#[test]
fn generate_writes_bucket_sized_webp_thumbnail() {
  let root = unique_test_root("thumbnail-image-provider-generate");
  fs::create_dir_all(&root).expect("test root should be created");

  let source_path = root.join("source.png");
  let output_path = root.join("output.webp");
  write_png(&source_path, 300, 150);

  let provider = ImageThumbnailProvider;
  let outcome = provider
    .generate(
      ThumbnailJobInput {
        source_path: &source_path,
        bucket: ThumbnailBucket::Px64,
      },
      ThumbnailJobOutput {
        temp_output_path: &output_path,
      },
    )
    .expect("generate should succeed");

  assert!(matches!(outcome, ThumbnailGenerateOutcome::Ready));
  assert!(output_path.is_file());

  let (width, height) =
    image::image_dimensions(&output_path).expect("output dimensions should be readable");
  assert_eq!((width, height), (64, 32));

  fs::remove_dir_all(&root).expect("test root should be removed");
}

#[test]
fn generate_keeps_small_images_at_original_size() {
  let root = unique_test_root("thumbnail-image-provider-small");
  fs::create_dir_all(&root).expect("test root should be created");

  let source_path = root.join("small.png");
  let output_path = root.join("small.webp");
  write_png(&source_path, 120, 60);

  let provider = ImageThumbnailProvider;
  let outcome = provider
    .generate(
      ThumbnailJobInput {
        source_path: &source_path,
        bucket: ThumbnailBucket::Px256,
      },
      ThumbnailJobOutput {
        temp_output_path: &output_path,
      },
    )
    .expect("generate should succeed");

  assert!(matches!(outcome, ThumbnailGenerateOutcome::Ready));
  let (width, height) =
    image::image_dimensions(&output_path).expect("output dimensions should be readable");
  assert_eq!((width, height), (120, 60));

  fs::remove_dir_all(&root).expect("test root should be removed");
}

#[test]
fn generate_returns_error_for_missing_source_file() {
  let root = unique_test_root("thumbnail-image-provider-missing");
  fs::create_dir_all(&root).expect("test root should be created");

  let source_path = root.join("missing.png");
  let output_path = root.join("out.webp");
  let provider = ImageThumbnailProvider;
  let result = provider.generate(
    ThumbnailJobInput {
      source_path: &source_path,
      bucket: ThumbnailBucket::Px64,
    },
    ThumbnailJobOutput {
      temp_output_path: &output_path,
    },
  );

  assert!(result.is_err());
  assert!(!output_path.is_file());

  fs::remove_dir_all(&root).expect("test root should be removed");
}
