use std::path::Path;
use std::sync::Arc;

use crate::commands::thumbnail::types::ThumbnailBucket;

mod image;

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

#[derive(Clone)]
pub struct ProviderRegistry {
  providers: Arc<Vec<Arc<dyn ThumbnailProvider>>>,
}

impl Default for ProviderRegistry {
  fn default() -> Self {
    let image_provider: Arc<dyn ThumbnailProvider> = Arc::new(image::ImageThumbnailProvider);
    Self {
      providers: Arc::new(vec![image_provider]),
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
