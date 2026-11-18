//! Thumbnails from Windows itself: whatever Explorer shows (video frames, fonts, Office
//! documents, PDFs when a viewer that adds a thumbnailer is installed, ...).

use std::path::Path;

use windows::core::HSTRING;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
  CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
  BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{
  CoInitializeEx, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
  IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_RESIZETOFIT, SIIGBF_THUMBNAILONLY,
};

use crate::commands::thumbnail::providers::{
  webp_quality, ThumbnailGenerateOutcome, ThumbnailJobInput, ThumbnailJobOutput,
  ThumbnailProvider,
};

pub struct ShellThumbnailProvider;

impl ThumbnailProvider for ShellThumbnailProvider {
  fn id(&self) -> &'static str {
    "shell"
  }

  fn version(&self) -> u16 {
    1
  }

  // The registry asks this provider last, so it gets every file the others don't take.
  fn supports(&self, _source_path: &Path) -> bool {
    true
  }

  fn generate(
    &self,
    input: ThumbnailJobInput<'_>,
    output: ThumbnailJobOutput<'_>,
  ) -> Result<ThumbnailGenerateOutcome, String> {
    let _apartment = ComApartment::enter()?;
    let shell_path = HSTRING::from(without_verbatim_prefix(input.source_path).as_str());
    // Fails e.g. inside C:\Windows\Fonts, which the shell only shows through its Fonts view.
    let factory: IShellItemImageFactory =
      match unsafe { SHCreateItemFromParsingName(&shell_path, None::<&IBindCtx>) } {
        Ok(factory) => factory,
        Err(error) => return Ok(unsupported("Windows can't open this file for a thumbnail", &error)),
      };
    let size_px = input.bucket.px() as i32;
    // THUMBNAILONLY: no icon fallback, grayspace shows its own icons.
    let bitmap = match unsafe {
      factory.GetImage(SIZE { cx: size_px, cy: size_px }, SIIGBF_RESIZETOFIT | SIIGBF_THUMBNAILONLY)
    } {
      Ok(bitmap) => bitmap,
      Err(error) => return Ok(unsupported("Windows has no thumbnail for this file", &error)),
    };
    let pixels = read_bitmap(bitmap);
    unsafe {
      let _ = DeleteObject(bitmap.into());
    }
    let (width, height, rgba) = pixels?;

    let encoded = webp::Encoder::from_rgba(&rgba, width, height).encode(webp_quality(input.bucket));
    std::fs::write(output.temp_output_path, &*encoded).map_err(|error| error.to_string())?;
    Ok(ThumbnailGenerateOutcome::Ready)
  }
}

// The error code goes in too: many of these errors have no message text.
fn unsupported(what: &str, error: &windows::core::Error) -> ThumbnailGenerateOutcome {
  ThumbnailGenerateOutcome::Unsupported {
    reason: format!("{what} ({:#010X}).", error.code().0),
  }
}

// Each thumbnail job runs on its own thread, which needs COM for the shell calls.
struct ComApartment;

impl ComApartment {
  fn enter() -> Result<Self, String> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
      .ok()
      .map_err(|error| error.message())?;
    Ok(Self)
  }
}

impl Drop for ComApartment {
  fn drop(&mut self) {
    unsafe { CoUninitialize() };
  }
}

// `fs::canonicalize` returns `\\?\` paths, which the shell doesn't parse.
pub(super) fn without_verbatim_prefix(path: &Path) -> String {
  let text = path.to_string_lossy();
  if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
    return format!(r"\\{rest}");
  }
  text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

fn read_bitmap(bitmap: HBITMAP) -> Result<(u32, u32, Vec<u8>), String> {
  let mut info = BITMAP::default();
  let info_size = std::mem::size_of::<BITMAP>() as i32;
  if unsafe { GetObjectW(bitmap.into(), info_size, Some((&mut info as *mut BITMAP).cast())) } == 0 {
    return Err("Windows returned a thumbnail that can't be read.".to_string());
  }

  let width = info.bmWidth;
  let height = info.bmHeight.abs();
  let mut header = BITMAPINFO {
    bmiHeader: BITMAPINFOHEADER {
      biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
      biWidth: width,
      biHeight: -height, // top-down rows
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB.0,
      ..Default::default()
    },
    ..Default::default()
  };
  let mut pixels = vec![0u8; width as usize * height as usize * 4];
  let copied_lines = unsafe {
    let dc = CreateCompatibleDC(None);
    let lines = GetDIBits(
      dc,
      bitmap,
      0,
      height as u32,
      Some(pixels.as_mut_ptr().cast()),
      &mut header,
      DIB_RGB_COLORS,
    );
    let _ = DeleteDC(dc);
    lines
  };
  if copied_lines != height {
    return Err("Windows returned a thumbnail that can't be read.".to_string());
  }

  bgra_to_rgba(&mut pixels);
  Ok((width as u32, height as u32, pixels))
}

// Windows hands out premultiplied BGRA. Some thumbnailers leave alpha at 0 everywhere for
// opaque images, so an image without any alpha is treated as opaque.
pub(super) fn bgra_to_rgba(pixels: &mut [u8]) {
  let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
  for pixel in pixels.chunks_exact_mut(4) {
    pixel.swap(0, 2);
    if !has_alpha {
      pixel[3] = 255;
      continue;
    }
    let alpha = u32::from(pixel[3]);
    if alpha == 0 || alpha == 255 {
      continue;
    }
    for channel in &mut pixel[..3] {
      *channel = ((u32::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
    }
  }
}

#[cfg(test)]
mod tests;
