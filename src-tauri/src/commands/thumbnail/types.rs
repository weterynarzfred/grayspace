use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ThumbnailBucket {
    #[serde(rename = "64")]
    Px64,
    #[serde(rename = "256")]
    Px256,
}

impl ThumbnailBucket {
    pub fn px(self) -> u32 {
        match self {
            Self::Px64 => 64,
            Self::Px256 => 256,
        }
    }

    pub fn from_size_hint(size_hint_px: Option<u32>) -> Self {
        match size_hint_px.unwrap_or(64) {
            0..=64 => Self::Px64,
            _ => Self::Px256,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThumbnailPriority {
    Visible,
    Prefetch,
}

impl ThumbnailPriority {
    pub fn from_option(value: Option<Self>) -> Self {
        value.unwrap_or(Self::Visible)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThumbnailStatus {
    Ready,
    Pending,
    Unsupported,
    Error,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResolveItemInput {
    pub source_path: String,
    pub size_hint_px: Option<u32>,
    pub priority: Option<ThumbnailPriority>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResolveBatchRequest {
    pub items: Vec<ThumbnailResolveItemInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResolveItemResult {
    pub source_path: String,
    pub bucket_px: u32,
    pub key: String,
    pub status: ThumbnailStatus,
    pub thumbnail_path: Option<String>,
    pub mime: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResolveBatchResponse {
    pub results: Vec<ThumbnailResolveItemResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailUpdatePayload {
    pub source_path: String,
    pub bucket_px: u32,
    pub key: String,
    pub status: ThumbnailStatus,
    pub thumbnail_path: Option<String>,
    pub mime: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailPruneResult {
    pub removed_files: usize,
    pub removed_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailClearResult {
    pub removed_files: usize,
    pub removed_bytes: u64,
}
