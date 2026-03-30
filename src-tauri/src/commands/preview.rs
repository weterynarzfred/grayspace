use serde::Serialize;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_TEXT_PREVIEW_BYTES: usize = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FilePreview {
  Text {
    content: String,
    truncated: bool,
  },
  Image {
    #[serde(rename = "mimeType")]
    mime_type: String,
  },
  Audio {
    #[serde(rename = "mimeType")]
    mime_type: String,
  },
  Video {
    #[serde(rename = "mimeType")]
    mime_type: String,
  },
  Unsupported {
    reason: String,
  },
}

#[derive(Clone, Copy, Debug)]
enum ImageFormat {
  Png,
  Jpeg,
  Gif,
  Webp,
  Bmp,
}

impl ImageFormat {
  fn mime_type(self) -> &'static str {
    match self {
      ImageFormat::Png => "image/png",
      ImageFormat::Jpeg => "image/jpeg",
      ImageFormat::Gif => "image/gif",
      ImageFormat::Webp => "image/webp",
      ImageFormat::Bmp => "image/bmp",
    }
  }
}

fn detect_image_format(bytes: &[u8]) -> Option<ImageFormat> {
  if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
    return Some(ImageFormat::Png);
  }

  if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
    return Some(ImageFormat::Jpeg);
  }

  if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
    return Some(ImageFormat::Gif);
  }

  if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
    return Some(ImageFormat::Webp);
  }

  if bytes.starts_with(b"BM") {
    return Some(ImageFormat::Bmp);
  }

  None
}

fn detect_non_image_binary_type(bytes: &[u8]) -> Option<&'static str> {
  if bytes.starts_with(b"%PDF-") {
    return Some("PDF document");
  }

  if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
    return Some("ZIP archive");
  }

  None
}

fn path_extension_lowercase(path: &Path) -> Option<String> {
  path
    .extension()
    .and_then(|extension| extension.to_str())
    .map(|extension| extension.trim().to_ascii_lowercase())
    .filter(|extension| !extension.is_empty())
}

fn extension_to_audio_mime(extension: &str) -> Option<&'static str> {
  match extension {
    "mp3" => Some("audio/mpeg"),
    "wav" => Some("audio/wav"),
    "ogg" | "oga" | "opus" => Some("audio/ogg"),
    "flac" => Some("audio/flac"),
    "m4a" | "aac" => Some("audio/mp4"),
    "weba" => Some("audio/webm"),
    "aif" | "aiff" => Some("audio/aiff"),
    "mid" | "midi" => Some("audio/midi"),
    _ => None,
  }
}

fn extension_to_video_mime(extension: &str) -> Option<&'static str> {
  match extension {
    "mp4" | "m4v" => Some("video/mp4"),
    "mov" => Some("video/quicktime"),
    "webm" => Some("video/webm"),
    "ogv" => Some("video/ogg"),
    "avi" => Some("video/x-msvideo"),
    "mkv" => Some("video/x-matroska"),
    "mpeg" | "mpg" => Some("video/mpeg"),
    _ => None,
  }
}

fn detect_mp4_container_mime(bytes: &[u8], extension: Option<&str>) -> Option<&'static str> {
  if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
    return None;
  }

  let brand = &bytes[8..12];
  if brand == b"M4A " || brand == b"M4B " {
    return Some("audio/mp4");
  }

  if brand == b"qt  " {
    return Some("video/quicktime");
  }

  if matches!(
    brand,
    b"isom" | b"iso2" | b"avc1" | b"mp41" | b"mp42" | b"M4V " | b"MSNV"
  ) {
    return Some("video/mp4");
  }

  match extension {
    Some("m4a") | Some("aac") => Some("audio/mp4"),
    Some("mov") => Some("video/quicktime"),
    Some("mp4") | Some("m4v") => Some("video/mp4"),
    _ => None,
  }
}

fn detect_audio_mime(bytes: &[u8], path: &Path) -> Option<&'static str> {
  if bytes.starts_with(b"ID3") {
    return Some("audio/mpeg");
  }

  if bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0 {
    return Some("audio/mpeg");
  }

  if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE" {
    return Some("audio/wav");
  }

  if bytes.starts_with(b"fLaC") {
    return Some("audio/flac");
  }

  let extension = path_extension_lowercase(path);
  if bytes.starts_with(b"OggS") {
    if extension.as_deref() == Some("ogv") {
      return None;
    }
    return Some("audio/ogg");
  }

  if let Some(mime_type) = detect_mp4_container_mime(bytes, extension.as_deref()) {
    if mime_type.starts_with("audio/") {
      return Some(mime_type);
    }
  }

  extension.as_deref().and_then(extension_to_audio_mime)
}

fn detect_video_mime(bytes: &[u8], path: &Path) -> Option<&'static str> {
  if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"AVI " {
    return Some("video/x-msvideo");
  }

  let extension = path_extension_lowercase(path);

  if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
    if extension.as_deref() == Some("weba") {
      return None;
    }
    return Some("video/webm");
  }

  if bytes.starts_with(b"OggS") && extension.as_deref() == Some("ogv") {
    return Some("video/ogg");
  }

  if let Some(mime_type) = detect_mp4_container_mime(bytes, extension.as_deref()) {
    if mime_type.starts_with("video/") {
      return Some(mime_type);
    }
  }

  extension.as_deref().and_then(extension_to_video_mime)
}

fn looks_like_plain_text(bytes: &[u8]) -> bool {
  if bytes.is_empty() {
    return true;
  }

  if bytes.contains(&0) {
    return false;
  }

  if std::str::from_utf8(bytes).is_err() {
    return false;
  }

  !bytes
    .iter()
    .any(|byte| *byte < 0x20 && *byte != b'\n' && *byte != b'\r' && *byte != b'\t')
}

fn read_file_prefix(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
  let file = File::open(path).map_err(|error| error.to_string())?;
  let mut bytes = Vec::new();
  file
    .take(max_bytes as u64)
    .read_to_end(&mut bytes)
    .map_err(|error| error.to_string())?;
  Ok(bytes)
}

fn unsupported_preview(reason: impl Into<String>) -> FilePreview {
  FilePreview::Unsupported {
    reason: reason.into(),
  }
}

fn detect_non_text_preview(path: &Path, metadata_size: u64, bytes: &[u8]) -> Option<FilePreview> {
  if let Some(image_format) = detect_image_format(bytes) {
    if metadata_size > MAX_IMAGE_PREVIEW_BYTES {
      return Some(unsupported_preview("Image preview is limited to 64 MB."));
    }
    return Some(FilePreview::Image {
      mime_type: image_format.mime_type().to_string(),
    });
  }

  if let Some(mime_type) = detect_audio_mime(bytes, path) {
    return Some(FilePreview::Audio {
      mime_type: mime_type.to_string(),
    });
  }

  if let Some(mime_type) = detect_video_mime(bytes, path) {
    return Some(FilePreview::Video {
      mime_type: mime_type.to_string(),
    });
  }

  detect_non_image_binary_type(bytes).map(|binary_type| {
    unsupported_preview(format!("{binary_type} previews are not supported yet."))
  })
}

#[tauri::command]
pub fn preview_read_file(path: &str) -> Result<FilePreview, String> {
  let file_path = PathBuf::from(path);
  if !file_path.exists() {
    return Err("The selected path does not exist.".to_string());
  }

  if file_path.is_dir() {
    return Ok(unsupported_preview(
      "Folder previews are not supported yet.",
    ));
  }

  if !file_path.is_file() {
    return Err("Preview is only available for files.".to_string());
  }

  let metadata = file_path.metadata().map_err(|error| error.to_string())?;
  let detection_bytes = read_file_prefix(&file_path, 64)?;
  if let Some(preview) = detect_non_text_preview(&file_path, metadata.len(), &detection_bytes) {
    return Ok(preview);
  }

  let truncated = metadata.len() > MAX_TEXT_PREVIEW_BYTES as u64;
  let text_bytes = read_file_prefix(&file_path, MAX_TEXT_PREVIEW_BYTES)?;

  if !looks_like_plain_text(&text_bytes) {
    return Ok(unsupported_preview(
      "Binary file previews are not supported yet.",
    ));
  }

  let content = String::from_utf8(text_bytes).map_err(|error| error.to_string())?;
  Ok(FilePreview::Text { content, truncated })
}

#[tauri::command]
pub fn preview_write_text_file(path: &str, content: &str) -> Result<(), String> {
  let file_path = PathBuf::from(path);
  if !file_path.exists() {
    return Err("The selected path does not exist.".to_string());
  }

  if !file_path.is_file() {
    return Err("Preview edits can only be saved to files.".to_string());
  }

  fs::write(&file_path, content).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
