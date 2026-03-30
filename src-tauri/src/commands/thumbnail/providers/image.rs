use std::path::Path;

use fast_image_resize as fir;

use crate::commands::thumbnail::providers::{
  ThumbnailGenerateOutcome, ThumbnailJobInput, ThumbnailJobOutput, ThumbnailProvider,
};
use crate::commands::thumbnail::types::ThumbnailBucket;

const SUPPORTED_EXTENSIONS: &[&str] = &[
  "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "ico",
];
const MAX_SOURCE_PIXELS: u64 = 160_000_000;

pub struct ImageThumbnailProvider;

impl ImageThumbnailProvider {
  fn quality_for_bucket(bucket: ThumbnailBucket) -> f32 {
    match bucket {
      ThumbnailBucket::Px64 => 48.0,
      ThumbnailBucket::Px256 => 68.0,
    }
  }

  fn resize_options_for_bucket(bucket: ThumbnailBucket) -> fir::ResizeOptions {
    match bucket {
      ThumbnailBucket::Px64 => fir::ResizeOptions::new().resize_alg(fir::ResizeAlg::Nearest),
      ThumbnailBucket::Px256 => {
        fir::ResizeOptions::new().resize_alg(fir::ResizeAlg::Convolution(fir::FilterType::Bilinear))
      }
    }
  }

  fn extension_supported(source_path: &Path) -> bool {
    source_path
      .extension()
      .and_then(|extension| extension.to_str())
      .map(|extension| extension.trim().to_ascii_lowercase())
      .filter(|extension| !extension.is_empty())
      .is_some_and(|extension| SUPPORTED_EXTENSIONS.contains(&extension.as_str()))
  }

  fn fit_inside_bucket(width: u32, height: u32, bucket_px: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
      return (1, 1);
    }

    if width <= bucket_px && height <= bucket_px {
      return (width, height);
    }

    if width >= height {
      let dst_height = ((u64::from(height) * u64::from(bucket_px)) / u64::from(width)).max(1);
      return (bucket_px, dst_height as u32);
    }

    let dst_width = ((u64::from(width) * u64::from(bucket_px)) / u64::from(height)).max(1);
    (dst_width as u32, bucket_px)
  }
}

impl ThumbnailProvider for ImageThumbnailProvider {
  fn id(&self) -> &'static str {
    "image"
  }

  fn version(&self) -> u16 {
    3
  }

  fn supports(&self, source_path: &Path) -> bool {
    Self::extension_supported(source_path)
  }

  fn generate(
    &self,
    input: ThumbnailJobInput<'_>,
    output: ThumbnailJobOutput<'_>,
  ) -> Result<ThumbnailGenerateOutcome, String> {
    let (width, height) =
      image::image_dimensions(input.source_path).map_err(|error| error.to_string())?;
    let source_pixel_count = u64::from(width) * u64::from(height);
    if source_pixel_count > MAX_SOURCE_PIXELS {
      return Ok(ThumbnailGenerateOutcome::Unsupported {
        reason: "Image is too large to thumbnail safely.".to_string(),
      });
    }

    let source_rgba = image::open(input.source_path)
      .map_err(|error| error.to_string())?
      .into_rgba8();

    let source_width = source_rgba.width();
    let source_height = source_rgba.height();
    let bucket_px = input.bucket.px();
    let (target_width, target_height) =
      Self::fit_inside_bucket(source_width, source_height, bucket_px);

    let source_image = fir::images::Image::from_vec_u8(
      source_width,
      source_height,
      source_rgba.into_raw(),
      fir::PixelType::U8x4,
    )
    .map_err(|error| error.to_string())?;
    let mut target_image =
      fir::images::Image::new(target_width, target_height, fir::PixelType::U8x4);

    let mut resizer = fir::Resizer::new();
    let options = Self::resize_options_for_bucket(input.bucket);
    resizer
      .resize(&source_image, &mut target_image, &options)
      .map_err(|error| error.to_string())?;

    let encoded = webp::Encoder::from_rgba(target_image.buffer(), target_width, target_height)
      .encode(Self::quality_for_bucket(input.bucket));

    std::fs::write(output.temp_output_path, &*encoded).map_err(|error| error.to_string())?;
    Ok(ThumbnailGenerateOutcome::Ready)
  }
}
