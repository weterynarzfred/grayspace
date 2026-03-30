use super::{
  preview_read_file, preview_write_text_file, FilePreview, MAX_IMAGE_PREVIEW_BYTES,
  MAX_TEXT_PREVIEW_BYTES,
};
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
    FilePreview::Image { mime_type } => assert_eq!(mime_type, "image/png"),
    _ => panic!("expected image preview"),
  };

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn preview_read_file_returns_audio_preview_for_mp3() {
  let test_root = unique_test_root("grayspace_preview_mp3");
  let file_path = test_root.join("audio.mp3");
  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(&file_path, b"ID3\x04\x00\x00\x00\x00\x00\x00").expect("should write mp3 header");

  let preview = preview_read_file(&file_path.to_string_lossy()).expect("preview should load");
  match preview {
    FilePreview::Audio { mime_type } => assert_eq!(mime_type, "audio/mpeg"),
    _ => panic!("expected audio preview"),
  };

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn preview_read_file_returns_video_preview_for_mp4() {
  let test_root = unique_test_root("grayspace_preview_mp4");
  let file_path = test_root.join("video.mp4");
  fs::create_dir_all(&test_root).expect("should create temp root");
  let mp4_header = vec![
    0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm', 0x00, 0x00, 0x00, 0x01,
    b'i', b's', b'o', b'm', b'm', b'p', b'4', b'1',
  ];
  fs::write(&file_path, mp4_header).expect("should write mp4 header");

  let preview = preview_read_file(&file_path.to_string_lossy()).expect("preview should load");
  match preview {
    FilePreview::Video { mime_type } => assert_eq!(mime_type, "video/mp4"),
    _ => panic!("expected video preview"),
  };

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
      assert_eq!(reason, "Image preview is limited to 64 MB.");
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
fn preview_read_file_marks_directories_as_unsupported() {
  let test_root = unique_test_root("grayspace_preview_dir");
  fs::create_dir_all(&test_root).expect("should create temp root");

  let preview = preview_read_file(&test_root.to_string_lossy()).expect("preview should load");
  match preview {
    FilePreview::Unsupported { reason } => {
      assert_eq!(reason, "Folder previews are not supported yet.");
    }
    _ => panic!("expected unsupported preview for directory"),
  }

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn image_preview_serializes_with_camel_case_fields() {
  let payload = serde_json::to_value(FilePreview::Image {
    mime_type: "image/png".to_string(),
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
  assert!(
    payload.get("mime_type").is_none(),
    "snake_case mime_type key should not be present"
  );
}

#[test]
fn media_preview_serializes_with_camel_case_fields() {
  let audio_payload = serde_json::to_value(FilePreview::Audio {
    mime_type: "audio/mpeg".to_string(),
  })
  .expect("audio preview should serialize");
  let video_payload = serde_json::to_value(FilePreview::Video {
    mime_type: "video/mp4".to_string(),
  })
  .expect("video preview should serialize");

  assert_eq!(
    audio_payload.get("kind").and_then(Value::as_str),
    Some("audio"),
    "kind should be serialized as audio"
  );
  assert_eq!(
    audio_payload.get("mimeType").and_then(Value::as_str),
    Some("audio/mpeg"),
    "audio mimeType should use camelCase"
  );
  assert_eq!(
    video_payload.get("kind").and_then(Value::as_str),
    Some("video"),
    "kind should be serialized as video"
  );
  assert_eq!(
    video_payload.get("mimeType").and_then(Value::as_str),
    Some("video/mp4"),
    "video mimeType should use camelCase"
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
