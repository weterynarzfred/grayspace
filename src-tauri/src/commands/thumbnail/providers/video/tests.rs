use super::{
  frame_detail, frame_times, parse_duration_secs, VideoThumbnailProvider, MIN_FRAME_DETAIL,
};
use crate::commands::thumbnail::providers::{
  ThumbnailGenerateOutcome, ThumbnailJobInput, ThumbnailJobOutput, ThumbnailProvider,
};
use crate::commands::thumbnail::types::ThumbnailBucket;
use image::{GenericImageView, Rgba, RgbaImage};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

fn bundled_ffmpeg() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("binaries")
    .join(format!("ffmpeg-x86_64-pc-windows-msvc{}", env::consts::EXE_SUFFIX))
}

fn unique_test_root(prefix: &str) -> PathBuf {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("clock should be monotonic")
    .as_nanos();
  let root = env::temp_dir().join(format!("{prefix}-{timestamp}"));
  fs::create_dir_all(&root).expect("test root should be created");
  root
}

fn generate(provider: &VideoThumbnailProvider, source_path: &Path, output_path: &Path) -> ThumbnailGenerateOutcome {
  provider
    .generate(
      ThumbnailJobInput {
        source_path,
        bucket: ThumbnailBucket::Px256,
      },
      ThumbnailJobOutput {
        temp_output_path: output_path,
      },
    )
    .expect("generate should not fail")
}

#[test]
fn supports_video_extensions_but_not_typescript() {
  let provider = VideoThumbnailProvider::new(bundled_ffmpeg());
  assert!(provider.supports(Path::new(r"C:\videos\clip.MKV")));
  assert!(provider.supports(Path::new(r"C:\videos\clip.mp4")));
  assert!(!provider.supports(Path::new(r"C:\code\app.ts")));
  assert!(!provider.supports(Path::new(r"C:\videos\cover.jpg")));
}

#[test]
fn reads_the_duration_from_the_ffmpeg_log() {
  let log = "Input #0, mov,mp4 from 'a.mp4':\n  Duration: 01:02:03.50, start: 0.000000, bitrate: 900 kb/s\n";
  assert_eq!(parse_duration_secs(log), Some(3723.5));
  assert_eq!(parse_duration_secs("  Duration: N/A, start: 0.000000"), None);
  assert_eq!(parse_duration_secs("no input"), None);
}

#[test]
fn tries_a_quarter_in_first_and_the_start_for_short_videos() {
  assert_eq!(frame_times(Some(100.0)), vec![25.0, 35.0, 50.0, 15.0, 65.0]);
  assert_eq!(frame_times(Some(0.4)), vec![0.0]);
  assert_eq!(frame_times(None), vec![0.0]);
}

#[test]
fn flat_frames_have_no_detail() {
  assert_eq!(frame_detail(&RgbaImage::from_pixel(8, 8, Rgba([0, 0, 0, 255]))), 0.0);
  let checkerboard = RgbaImage::from_fn(8, 8, |x, y| {
    if (x + y) % 2 == 0 { Rgba([0, 0, 0, 255]) } else { Rgba([255, 255, 255, 255]) }
  });
  assert!(frame_detail(&checkerboard) > MIN_FRAME_DETAIL);
}

#[test]
fn skips_black_frames_and_writes_a_webp_thumbnail() {
  let ffmpeg = bundled_ffmpeg();
  let root = unique_test_root("grayspace-video-thumbnail");
  let source_path = root.join("black-then-pattern.mp4");
  // 4 s: black until 1.6 s, so the frames at 25% (1.0 s) and 35% (1.4 s) are empty.
  let status = Command::new(&ffmpeg)
    .args([
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=1.6",
      "-f", "lavfi", "-i", "testsrc=s=320x180:r=10:d=2.4",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v", "mpeg4", "-g", "5",
    ])
    .arg(&source_path)
    .status()
    .expect("ffmpeg should run");
  assert!(status.success(), "test video should be created");
  let output_path = root.join("thumbnail.webp");

  let outcome = generate(&VideoThumbnailProvider::new(ffmpeg), &source_path, &output_path);

  assert!(matches!(outcome, ThumbnailGenerateOutcome::Ready));
  let thumbnail = image::open(&output_path).expect("thumbnail should be readable");
  assert_eq!(thumbnail.dimensions(), (256, 144));
  assert!(frame_detail(&thumbnail.into_rgba8()) > MIN_FRAME_DETAIL);

  let _ = fs::remove_dir_all(root);
}

#[test]
fn reports_unreadable_videos_and_missing_ffmpeg_as_unsupported() {
  let root = unique_test_root("grayspace-video-thumbnail-broken");
  let source_path = root.join("not-a-video.mp4");
  fs::write(&source_path, "plain text").expect("source should be written");
  let output_path = root.join("thumbnail.webp");

  let broken = generate(&VideoThumbnailProvider::new(bundled_ffmpeg()), &source_path, &output_path);
  let missing = generate(
    &VideoThumbnailProvider::new(root.join("no-ffmpeg.exe")),
    &source_path,
    &output_path,
  );

  assert!(matches!(broken, ThumbnailGenerateOutcome::Unsupported { .. }));
  assert!(matches!(missing, ThumbnailGenerateOutcome::Unsupported { .. }));
  let _ = fs::remove_dir_all(root);
}
