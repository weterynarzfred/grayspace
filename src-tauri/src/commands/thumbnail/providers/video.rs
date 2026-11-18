//! Video thumbnails from the bundled ffmpeg. It runs as its own process with a time limit, so a
//! video that makes it hang or crash only costs that video's thumbnail.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use image::RgbaImage;

use crate::commands::thumbnail::providers::{
  webp_quality, ThumbnailGenerateOutcome, ThumbnailJobInput, ThumbnailJobOutput,
  ThumbnailProvider,
};

// Not "ts": far more often TypeScript than MPEG transport streams.
const SUPPORTED_EXTENSIONS: &[&str] = &[
  "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "mpg", "mpeg", "m2ts", "mts", "3gp",
  "ogv",
];
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(15);
// Share of the video's length, tried in this order until a frame isn't empty.
const FRAME_POSITIONS: [f64; 5] = [0.25, 0.35, 0.5, 0.15, 0.65];
// Brightness spread (standard deviation, 0-255) below which a frame counts as empty: black,
// white or one flat colour. Dark but real scenes stay above it.
pub(super) const MIN_FRAME_DETAIL: f64 = 12.0;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct VideoThumbnailProvider {
  ffmpeg_path: PathBuf,
}

impl VideoThumbnailProvider {
  pub fn new(ffmpeg_path: PathBuf) -> Self {
    Self { ffmpeg_path }
  }

  // Tauri puts bundled binaries next to the app's executable, without the target triple.
  pub fn bundled() -> Self {
    let app_dir = std::env::current_exe()
      .ok()
      .and_then(|exe| exe.parent().map(Path::to_path_buf))
      .unwrap_or_default();
    Self::new(app_dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)))
  }

  fn command(&self) -> Command {
    let mut command = Command::new(&self.ffmpeg_path);
    command.args(["-hide_banner", "-nostdin"]);
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      command.creation_flags(CREATE_NO_WINDOW);
    }
    command
  }

  fn duration_secs(&self, source_path: &Path) -> Result<Option<f64>, String> {
    let mut command = self.command();
    command.arg("-i").arg(source_path);
    let output = run_with_timeout(command)?;
    Ok(parse_duration_secs(&String::from_utf8_lossy(&output.stderr)))
  }

  fn frame_at(&self, source_path: &Path, seconds: f64, size_px: u32) -> Result<RgbaImage, String> {
    let mut command = self.command();
    command
      .args(["-loglevel", "error", "-ss", &format!("{seconds:.3}"), "-i"])
      .arg(source_path)
      .args(["-frames:v", "1", "-an", "-sn", "-vf"])
      // The first scale fixes non-square pixels; the second fits the frame into the bucket.
      .arg(format!(
        "scale=iw*sar:ih,scale={size_px}:{size_px}:force_original_aspect_ratio=decrease"
      ))
      .args(["-f", "image2pipe", "-c:v", "png", "pipe:1"]);
    let output = run_with_timeout(command)?;
    if output.stdout.is_empty() {
      let log = String::from_utf8_lossy(&output.stderr);
      let reason = log.lines().last().unwrap_or("no frame");
      return Err(format!("ffmpeg could not read a frame: {reason}"));
    }
    image::load_from_memory(&output.stdout)
      .map(|frame| frame.into_rgba8())
      .map_err(|error| error.to_string())
  }

  fn pick_frame(&self, source_path: &Path, size_px: u32) -> Result<RgbaImage, String> {
    let duration = self.duration_secs(source_path)?;
    let mut best: Option<(f64, RgbaImage)> = None;
    for seconds in frame_times(duration) {
      let frame = self.frame_at(source_path, seconds, size_px)?;
      let detail = frame_detail(&frame);
      if detail >= MIN_FRAME_DETAIL {
        return Ok(frame);
      }
      if best.as_ref().is_none_or(|(best_detail, _)| detail > *best_detail) {
        best = Some((detail, frame));
      }
    }
    // Every frame looked empty: keep the one with the most in it.
    best
      .map(|(_, frame)| frame)
      .ok_or_else(|| "ffmpeg found no frame.".to_string())
  }
}

impl ThumbnailProvider for VideoThumbnailProvider {
  fn id(&self) -> &'static str {
    "video"
  }

  fn version(&self) -> u16 {
    1
  }

  fn supports(&self, source_path: &Path) -> bool {
    source_path
      .extension()
      .and_then(|extension| extension.to_str())
      .is_some_and(|extension| SUPPORTED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
  }

  fn generate(
    &self,
    input: ThumbnailJobInput<'_>,
    output: ThumbnailJobOutput<'_>,
  ) -> Result<ThumbnailGenerateOutcome, String> {
    if !self.ffmpeg_path.is_file() {
      return Ok(ThumbnailGenerateOutcome::Unsupported {
        reason: format!("ffmpeg is missing: {}", self.ffmpeg_path.display()),
      });
    }
    // Unsupported rather than an error: it's remembered, so a broken or hanging video
    // isn't sent to ffmpeg again on every scroll.
    let frame = match self.pick_frame(input.source_path, input.bucket.px()) {
      Ok(frame) => frame,
      Err(reason) => return Ok(ThumbnailGenerateOutcome::Unsupported { reason }),
    };

    let encoded = webp::Encoder::from_rgba(frame.as_raw(), frame.width(), frame.height())
      .encode(webp_quality(input.bucket));
    std::fs::write(output.temp_output_path, &*encoded).map_err(|error| error.to_string())?;
    Ok(ThumbnailGenerateOutcome::Ready)
  }
}

fn run_with_timeout(mut command: Command) -> Result<Output, String> {
  let mut child = command
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("ffmpeg could not start: {error}"))?;
  // Pipes are drained on their own threads so a chatty ffmpeg can't block on a full pipe.
  let stdout = read_in_background(child.stdout.take());
  let stderr = read_in_background(child.stderr.take());
  let deadline = Instant::now() + FFMPEG_TIMEOUT;
  let status = loop {
    if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
      break status;
    }
    if Instant::now() >= deadline {
      let _ = child.kill();
      let _ = child.wait();
      return Err(format!("ffmpeg took longer than {} s.", FFMPEG_TIMEOUT.as_secs()));
    }
    thread::sleep(Duration::from_millis(20));
  };
  Ok(Output {
    status,
    stdout: stdout.join().unwrap_or_default(),
    stderr: stderr.join().unwrap_or_default(),
  })
}

fn read_in_background(pipe: Option<impl Read + Send + 'static>) -> thread::JoinHandle<Vec<u8>> {
  thread::spawn(move || {
    let mut bytes = Vec::new();
    if let Some(mut pipe) = pipe {
      let _ = pipe.read_to_end(&mut bytes);
    }
    bytes
  })
}

// ffmpeg logs e.g. "  Duration: 00:01:23.45, start: ..." or "Duration: N/A" for streams.
pub(super) fn parse_duration_secs(ffmpeg_log: &str) -> Option<f64> {
  let clock = ffmpeg_log.split("Duration: ").nth(1)?.split(',').next()?;
  let mut parts = clock.trim().split(':').map(|part| part.parse::<f64>().ok());
  let (hours, minutes, seconds) = (parts.next()??, parts.next()??, parts.next()??);
  Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

// Very short videos, or ones without a known length, use the frame at the start.
pub(super) fn frame_times(duration_secs: Option<f64>) -> Vec<f64> {
  match duration_secs {
    Some(duration) if duration >= 1.0 => {
      FRAME_POSITIONS.iter().map(|position| duration * position).collect()
    }
    _ => vec![0.0],
  }
}

pub(super) fn frame_detail(frame: &RgbaImage) -> f64 {
  let lumas: Vec<f64> = frame
    .pixels()
    .map(|pixel| {
      let [red, green, blue, _] = pixel.0;
      0.299 * f64::from(red) + 0.587 * f64::from(green) + 0.114 * f64::from(blue)
    })
    .collect();
  if lumas.is_empty() {
    return 0.0;
  }
  let count = lumas.len() as f64;
  let mean = lumas.iter().sum::<f64>() / count;
  let variance = lumas.iter().map(|luma| (luma - mean).powi(2)).sum::<f64>() / count;
  variance.sqrt()
}

#[cfg(test)]
mod tests;
