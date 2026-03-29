use base64::{engine::general_purpose::STANDARD, Engine as _};
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
        #[serde(rename = "dataBase64")]
        data_base64: String,
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

    if bytes.starts_with(b"ID3") {
        return Some("MP3 audio");
    }

    None
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
    file.take(max_bytes as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

#[tauri::command]
pub fn preview_read_file(path: &str) -> Result<FilePreview, String> {
    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        return Err("The selected path does not exist.".to_string());
    }

    if !file_path.is_file() {
        return Err("Preview is only available for files.".to_string());
    }

    let metadata = file_path.metadata().map_err(|error| error.to_string())?;
    let detection_bytes = read_file_prefix(&file_path, 64)?;

    if let Some(image_format) = detect_image_format(&detection_bytes) {
        if metadata.len() > MAX_IMAGE_PREVIEW_BYTES {
            return Ok(FilePreview::Unsupported {
                reason: "Image preview is limited to 64 MB.".to_string(),
            });
        }

        let image_bytes = fs::read(&file_path).map_err(|error| error.to_string())?;
        return Ok(FilePreview::Image {
            mime_type: image_format.mime_type().to_string(),
            data_base64: STANDARD.encode(image_bytes),
        });
    }

    if let Some(binary_type) = detect_non_image_binary_type(&detection_bytes) {
        return Ok(FilePreview::Unsupported {
            reason: format!("{binary_type} previews are not supported yet."),
        });
    }

    let truncated = metadata.len() > MAX_TEXT_PREVIEW_BYTES as u64;
    let text_bytes = read_file_prefix(&file_path, MAX_TEXT_PREVIEW_BYTES)?;

    if !looks_like_plain_text(&text_bytes) {
        return Ok(FilePreview::Unsupported {
            reason: "Binary file previews are not supported yet.".to_string(),
        });
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
mod tests {
    use super::{
        preview_read_file, preview_write_text_file, FilePreview, MAX_IMAGE_PREVIEW_BYTES,
        MAX_TEXT_PREVIEW_BYTES,
    };
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_root(prefix: &str) -> PathBuf {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
    }

    #[test]
    fn preview_read_file_returns_text_preview_for_utf8_text() {
        let test_root = unique_test_root("grayspace_preview_text");
        let file_path = test_root.join("notes.txt");
        fs::create_dir_all(&test_root).expect("should create temp root");
        fs::write(&file_path, "hello from preview").expect("should write text file");

        let preview = preview_read_file(&file_path.to_string_lossy()).expect("preview should load");
        match preview {
            FilePreview::Text { content, truncated } => {
                assert_eq!(content, "hello from preview");
                assert!(!truncated, "small text file should not be truncated");
            }
            _ => panic!("expected text preview"),
        }

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn preview_read_file_marks_truncated_for_large_text() {
        let test_root = unique_test_root("grayspace_preview_large_text");
        let file_path = test_root.join("large.txt");
        fs::create_dir_all(&test_root).expect("should create temp root");
        let large_text = "a".repeat(MAX_TEXT_PREVIEW_BYTES + 16);
        fs::write(&file_path, large_text).expect("should write large text file");

        let preview = preview_read_file(&file_path.to_string_lossy()).expect("preview should load");
        match preview {
            FilePreview::Text { content, truncated } => {
                assert_eq!(content.len(), MAX_TEXT_PREVIEW_BYTES);
                assert!(truncated, "large text file should be marked as truncated");
            }
            _ => panic!("expected text preview"),
        }

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn preview_read_file_returns_image_preview_for_png() {
        let test_root = unique_test_root("grayspace_preview_png");
        let file_path = test_root.join("image.png");
        fs::create_dir_all(&test_root).expect("should create temp root");
        let png_bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
        fs::write(&file_path, &png_bytes).expect("should write png bytes");

        let preview = preview_read_file(&file_path.to_string_lossy()).expect("preview should load");
        match preview {
            FilePreview::Image {
                mime_type,
                data_base64,
            } => {
                assert_eq!(mime_type, "image/png");
                let decoded_bytes = STANDARD
                    .decode(data_base64)
                    .expect("image payload should contain valid base64");
                assert_eq!(decoded_bytes, png_bytes);
            }
            _ => panic!("expected image preview"),
        }

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn preview_read_file_rejects_images_that_are_too_large() {
        let test_root = unique_test_root("grayspace_preview_large_image");
        let file_path = test_root.join("large-image.png");
        fs::create_dir_all(&test_root).expect("should create temp root");

        let mut image_bytes = vec![0_u8; (MAX_IMAGE_PREVIEW_BYTES + 1) as usize];
        image_bytes[..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        fs::write(&file_path, image_bytes).expect("should write large image bytes");

        let preview = preview_read_file(&file_path.to_string_lossy()).expect("preview should load");
        match preview {
            FilePreview::Unsupported { reason } => {
                assert_eq!(reason, "Image preview is limited to 8 MB.");
            }
            _ => panic!("expected unsupported preview for large image"),
        }

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn preview_read_file_reports_non_image_binary_type_as_unsupported() {
        let test_root = unique_test_root("grayspace_preview_pdf");
        let file_path = test_root.join("document.pdf");
        fs::create_dir_all(&test_root).expect("should create temp root");
        fs::write(&file_path, b"%PDF-1.7\n").expect("should write pdf bytes");

        let preview = preview_read_file(&file_path.to_string_lossy()).expect("preview should load");
        match preview {
            FilePreview::Unsupported { reason } => {
                assert!(reason.contains("PDF document"), "expected PDF reason");
            }
            _ => panic!("expected unsupported preview"),
        }

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn preview_read_file_rejects_directories() {
        let test_root = unique_test_root("grayspace_preview_dir");
        fs::create_dir_all(&test_root).expect("should create temp root");

        let result = preview_read_file(&test_root.to_string_lossy());
        assert!(result.is_err(), "directories should not be previewable");
        assert_eq!(
            result.expect_err("directory preview should fail"),
            "Preview is only available for files."
        );

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn image_preview_serializes_with_camel_case_fields() {
        let payload = serde_json::to_value(FilePreview::Image {
            mime_type: "image/png".to_string(),
            data_base64: "AAAA".to_string(),
        })
        .expect("image preview should serialize");

        assert_eq!(
            payload.get("kind").and_then(Value::as_str),
            Some("image"),
            "kind should be serialized as image"
        );
        assert_eq!(
            payload.get("mimeType").and_then(Value::as_str),
            Some("image/png"),
            "mimeType should use camelCase"
        );
        assert_eq!(
            payload.get("dataBase64").and_then(Value::as_str),
            Some("AAAA"),
            "dataBase64 should use camelCase"
        );
        assert!(
            payload.get("mime_type").is_none(),
            "snake_case mime_type key should not be present"
        );
        assert!(
            payload.get("data_base64").is_none(),
            "snake_case data_base64 key should not be present"
        );
    }

    #[test]
    fn preview_write_text_file_updates_existing_file() {
        let test_root = unique_test_root("grayspace_preview_write");
        let file_path = test_root.join("editable.txt");
        fs::create_dir_all(&test_root).expect("should create temp root");
        fs::write(&file_path, "before").expect("should write original content");

        preview_write_text_file(&file_path.to_string_lossy(), "after")
            .expect("text file save should succeed");

        let saved = fs::read_to_string(&file_path).expect("should read saved content");
        assert_eq!(saved, "after");

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn preview_write_text_file_rejects_directories() {
        let test_root = unique_test_root("grayspace_preview_write_dir");
        fs::create_dir_all(&test_root).expect("should create temp root");

        let result = preview_write_text_file(&test_root.to_string_lossy(), "ignored");
        assert!(result.is_err(), "writing into a directory should fail");
        assert_eq!(
            result.expect_err("directory write should fail"),
            "Preview edits can only be saved to files."
        );

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }
}
