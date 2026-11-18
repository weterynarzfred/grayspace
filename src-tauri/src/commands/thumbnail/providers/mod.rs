use std::path::Path;
use std::sync::Arc;

use crate::commands::thumbnail::types::ThumbnailBucket;

mod image;
#[cfg(windows)]
mod shell;
mod video;

pub struct ThumbnailJobInput<'a> {
  pub source_path: &'a Path,
  pub bucket: ThumbnailBucket,
}

pub struct ThumbnailJobOutput<'a> {
  pub temp_output_path: &'a Path,
}

pub enum ThumbnailGenerateOutcome {
  Ready,
  Unsupported { reason: String },
}

pub trait ThumbnailProvider: Send + Sync {
  fn id(&self) -> &'static str;
  fn version(&self) -> u16;
  fn supports(&self, source_path: &Path) -> bool;
  fn generate(
    &self,
    input: ThumbnailJobInput<'_>,
    output: ThumbnailJobOutput<'_>,
  ) -> Result<ThumbnailGenerateOutcome, String>;
}

pub(super) fn webp_quality(bucket: ThumbnailBucket) -> f32 {
  match bucket {
    ThumbnailBucket::Px64 => 48.0,
    ThumbnailBucket::Px256 | ThumbnailBucket::Px512 => 68.0,
  }
}

#[derive(Clone)]
pub struct ProviderRegistry {
  providers: Arc<Vec<Arc<dyn ThumbnailProvider>>>,
}

impl Default for ProviderRegistry {
  fn default() -> Self {
    #[allow(unused_mut)]
    let mut providers: Vec<Arc<dyn ThumbnailProvider>> = vec![
      Arc::new(image::ImageThumbnailProvider),
      Arc::new(video::VideoThumbnailProvider::bundled()),
    ];
    // Last: it takes any file, so it only gets the ones the others don't.
    #[cfg(windows)]
    providers.push(Arc::new(shell::ShellThumbnailProvider));
    Self {
      providers: Arc::new(providers),
    }
  }
}

impl ProviderRegistry {
  pub fn find_for_path(&self, source_path: &Path) -> Option<Arc<dyn ThumbnailProvider>> {
    self
      .providers
      .iter()
      .find(|provider| provider.supports(source_path))
      .cloned()
  }
}
