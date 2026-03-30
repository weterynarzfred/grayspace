use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use self::providers::{
    ProviderRegistry, ThumbnailGenerateOutcome, ThumbnailJobInput, ThumbnailJobOutput,
    ThumbnailProvider,
};
use self::types::{
    ThumbnailBucket, ThumbnailClearResult, ThumbnailPriority, ThumbnailPruneResult,
    ThumbnailResolveBatchRequest, ThumbnailResolveBatchResponse, ThumbnailResolveItemInput,
    ThumbnailResolveItemResult, ThumbnailStatus, ThumbnailUpdatePayload,
};

mod providers;
mod types;

const THUMBNAIL_SCHEMA_VERSION: &str = "v1";
const THUMBNAIL_UPDATE_EVENT: &str = "thumbnail:update";
const THUMBNAIL_MAX_WORKERS: usize = 4;
const THUMBNAIL_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const THUMBNAIL_CACHE_MAX_AGE_SECS: u64 = 30 * 24 * 60 * 60;
const WEBP_MIME: &str = "image/webp";

#[derive(Clone)]
struct ThumbnailJob {
    source_path: String,
    key: String,
    bucket: ThumbnailBucket,
    output_path: PathBuf,
    input_path: PathBuf,
    provider: Arc<dyn ThumbnailProvider>,
}

#[derive(Default)]
struct ThumbnailQueueRuntime {
    visible_queue: VecDeque<ThumbnailJob>,
    prefetch_queue: VecDeque<ThumbnailJob>,
    queued_keys: HashSet<String>,
    in_flight_keys: HashSet<String>,
    active_workers: usize,
}

#[derive(Clone, Default)]
pub struct ThumbnailState {
    runtime: Arc<Mutex<ThumbnailQueueRuntime>>,
    providers: ProviderRegistry,
}

#[derive(Clone)]
struct CachedFile {
    path: PathBuf,
    size: u64,
    modified_secs: Option<u64>,
}

fn normalize_source_path(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_string())
}

fn system_time_to_unix_secs(value: Result<SystemTime, std::io::Error>) -> Option<u64> {
    value.ok().and_then(|time| {
        time.duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_secs())
    })
}

fn compute_fallback_key(source_path: &str, bucket: ThumbnailBucket) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"fallback");
    hasher.update(source_path.as_bytes());
    hasher.update(bucket.px().to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn compute_thumbnail_key(
    provider: &dyn ThumbnailProvider,
    canonical_source_path: &Path,
    metadata: &fs::Metadata,
    bucket: ThumbnailBucket,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(provider.id().as_bytes());
    hasher.update(provider.version().to_string().as_bytes());
    hasher.update(canonical_source_path.to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_string().as_bytes());
    hasher.update(
        system_time_to_unix_secs(metadata.modified())
            .unwrap_or(0)
            .to_string()
            .as_bytes(),
    );
    hasher.update(bucket.px().to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn thumbnail_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let root = app_data_dir
        .join("thumbnails")
        .join(THUMBNAIL_SCHEMA_VERSION);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn thumbnail_output_path(cache_root: &Path, bucket: ThumbnailBucket, key: &str) -> PathBuf {
    let first = key.get(0..2).unwrap_or("00");
    let second = key.get(2..4).unwrap_or("00");
    cache_root
        .join(bucket.px().to_string())
        .join(first)
        .join(second)
        .join(format!("{key}.webp"))
}

fn create_ready_result(
    source_path: String,
    key: String,
    bucket: ThumbnailBucket,
    output_path: PathBuf,
) -> ThumbnailResolveItemResult {
    ThumbnailResolveItemResult {
        source_path,
        bucket_px: bucket.px(),
        key,
        status: ThumbnailStatus::Ready,
        thumbnail_path: Some(output_path.to_string_lossy().to_string()),
        mime: Some(WEBP_MIME.to_string()),
        error: None,
    }
}

fn create_pending_result(
    source_path: String,
    key: String,
    bucket: ThumbnailBucket,
) -> ThumbnailResolveItemResult {
    ThumbnailResolveItemResult {
        source_path,
        bucket_px: bucket.px(),
        key,
        status: ThumbnailStatus::Pending,
        thumbnail_path: None,
        mime: None,
        error: None,
    }
}

fn create_unsupported_result(
    source_path: String,
    key: String,
    bucket: ThumbnailBucket,
    reason: impl Into<String>,
) -> ThumbnailResolveItemResult {
    ThumbnailResolveItemResult {
        source_path,
        bucket_px: bucket.px(),
        key,
        status: ThumbnailStatus::Unsupported,
        thumbnail_path: None,
        mime: None,
        error: Some(reason.into()),
    }
}

fn create_error_result(
    source_path: String,
    key: String,
    bucket: ThumbnailBucket,
    error: impl Into<String>,
) -> ThumbnailResolveItemResult {
    ThumbnailResolveItemResult {
        source_path,
        bucket_px: bucket.px(),
        key,
        status: ThumbnailStatus::Error,
        thumbnail_path: None,
        mime: None,
        error: Some(error.into()),
    }
}

fn queue_job_if_needed(state: &ThumbnailState, priority: ThumbnailPriority, job: ThumbnailJob) {
    let mut runtime = match state.runtime.lock() {
        Ok(runtime) => runtime,
        Err(_) => return,
    };

    if runtime.queued_keys.contains(&job.key) || runtime.in_flight_keys.contains(&job.key) {
        return;
    }

    runtime.queued_keys.insert(job.key.clone());
    match priority {
        ThumbnailPriority::Visible => runtime.visible_queue.push_back(job),
        ThumbnailPriority::Prefetch => runtime.prefetch_queue.push_back(job),
    }
}

fn pop_next_job(runtime: &mut ThumbnailQueueRuntime) -> Option<ThumbnailJob> {
    let job = runtime
        .visible_queue
        .pop_front()
        .or_else(|| runtime.prefetch_queue.pop_front())?;
    runtime.queued_keys.remove(&job.key);
    runtime.in_flight_keys.insert(job.key.clone());
    runtime.active_workers += 1;
    Some(job)
}

fn temporary_thumbnail_path(final_path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    final_path.with_file_name(format!(
        "{}.{stamp}.tmp",
        final_path
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default()
    ))
}

fn clear_temporary_file(path: &Path) {
    let _ = fs::remove_file(path);
}

fn payload_from_result(result: &ThumbnailResolveItemResult) -> ThumbnailUpdatePayload {
    ThumbnailUpdatePayload {
        source_path: result.source_path.clone(),
        bucket_px: result.bucket_px,
        key: result.key.clone(),
        status: result.status,
        thumbnail_path: result.thumbnail_path.clone(),
        mime: result.mime.clone(),
        error: result.error.clone(),
    }
}

fn process_thumbnail_job(job: &ThumbnailJob) -> ThumbnailResolveItemResult {
    if job.output_path.is_file() {
        return create_ready_result(
            job.source_path.clone(),
            job.key.clone(),
            job.bucket,
            job.output_path.clone(),
        );
    }

    let parent_dir = match job.output_path.parent() {
        Some(parent) => parent,
        None => {
            return create_error_result(
                job.source_path.clone(),
                job.key.clone(),
                job.bucket,
                "Failed to resolve thumbnail output directory.",
            );
        }
    };

    if let Err(error) = fs::create_dir_all(parent_dir) {
        return create_error_result(
            job.source_path.clone(),
            job.key.clone(),
            job.bucket,
            error.to_string(),
        );
    }

    let temp_path = temporary_thumbnail_path(&job.output_path);
    let generate_result = job.provider.generate(
        ThumbnailJobInput {
            source_path: &job.input_path,
            bucket: job.bucket,
        },
        ThumbnailJobOutput {
            temp_output_path: &temp_path,
        },
    );

    match generate_result {
        Ok(ThumbnailGenerateOutcome::Ready) => {
            let rename_result = fs::rename(&temp_path, &job.output_path);
            if let Err(error) = rename_result {
                if !job.output_path.exists() {
                    clear_temporary_file(&temp_path);
                    return create_error_result(
                        job.source_path.clone(),
                        job.key.clone(),
                        job.bucket,
                        error.to_string(),
                    );
                }
                clear_temporary_file(&temp_path);
            }

            create_ready_result(
                job.source_path.clone(),
                job.key.clone(),
                job.bucket,
                job.output_path.clone(),
            )
        }
        Ok(ThumbnailGenerateOutcome::Unsupported { reason }) => {
            clear_temporary_file(&temp_path);
            create_unsupported_result(job.source_path.clone(), job.key.clone(), job.bucket, reason)
        }
        Err(error) => {
            clear_temporary_file(&temp_path);
            create_error_result(job.source_path.clone(), job.key.clone(), job.bucket, error)
        }
    }
}

fn finish_job(state: &ThumbnailState, key: &str) {
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.in_flight_keys.remove(key);
        runtime.active_workers = runtime.active_workers.saturating_sub(1);
    }
}

fn pump_workers(app: AppHandle, state: ThumbnailState) {
    loop {
        let next_job = {
            let mut runtime = match state.runtime.lock() {
                Ok(runtime) => runtime,
                Err(_) => return,
            };

            if runtime.active_workers >= THUMBNAIL_MAX_WORKERS {
                return;
            }

            pop_next_job(&mut runtime)
        };

        let Some(job) = next_job else {
            return;
        };

        let worker_state = state.clone();
        let worker_app = app.clone();
        std::thread::spawn(move || {
            let result = process_thumbnail_job(&job);
            let _ = worker_app.emit(THUMBNAIL_UPDATE_EVENT, payload_from_result(&result));
            finish_job(&worker_state, &job.key);
            pump_workers(worker_app, worker_state);
        });
    }
}

fn resolve_item(
    item: ThumbnailResolveItemInput,
    cache_root: &Path,
    state: &ThumbnailState,
) -> ThumbnailResolveItemResult {
    let bucket = ThumbnailBucket::from_size_hint(item.size_hint_px);
    let Some(source_path) = normalize_source_path(&item.source_path) else {
        return create_error_result(
            item.source_path,
            compute_fallback_key("", bucket),
            bucket,
            "A source path is required.",
        );
    };
    let fallback_key = compute_fallback_key(&source_path, bucket);

    let canonical_source_path = match fs::canonicalize(&source_path) {
        Ok(path) => path,
        Err(error) => {
            return create_error_result(
                source_path,
                fallback_key,
                bucket,
                format!("Failed to read source path: {error}"),
            );
        }
    };

    if !canonical_source_path.is_file() {
        return create_unsupported_result(
            source_path,
            fallback_key,
            bucket,
            "Thumbnails are currently supported only for files.",
        );
    }

    let provider = match state.providers.find_for_path(&canonical_source_path) {
        Some(provider) => provider,
        None => {
            return create_unsupported_result(
                source_path,
                fallback_key,
                bucket,
                "No thumbnail provider is available for this file type yet.",
            );
        }
    };

    let metadata = match fs::metadata(&canonical_source_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return create_error_result(source_path, fallback_key, bucket, error.to_string());
        }
    };

    let key = compute_thumbnail_key(provider.as_ref(), &canonical_source_path, &metadata, bucket);
    let output_path = thumbnail_output_path(cache_root, bucket, &key);
    if output_path.is_file() {
        return create_ready_result(source_path, key, bucket, output_path);
    }

    let priority = ThumbnailPriority::from_option(item.priority);
    queue_job_if_needed(
        state,
        priority,
        ThumbnailJob {
            source_path: source_path.clone(),
            key: key.clone(),
            bucket,
            output_path,
            input_path: canonical_source_path,
            provider,
        },
    );
    create_pending_result(source_path, key, bucket)
}

fn collect_cached_files(root: &Path) -> Result<Vec<CachedFile>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut stack = vec![root.to_path_buf()];
    let mut files = Vec::new();

    while let Some(directory) = stack.pop() {
        let read_dir = fs::read_dir(&directory).map_err(|error| error.to_string())?;
        for entry in read_dir {
            let dir_entry = entry.map_err(|error| error.to_string())?;
            let path = dir_entry.path();
            let file_type = dir_entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let metadata = dir_entry.metadata().map_err(|error| error.to_string())?;
            files.push(CachedFile {
                path,
                size: metadata.len(),
                modified_secs: system_time_to_unix_secs(metadata.modified()),
            });
        }
    }

    Ok(files)
}

fn prune_cached_files(root: &Path) -> Result<ThumbnailPruneResult, String> {
    let mut files = collect_cached_files(root)?;
    if files.is_empty() {
        return Ok(ThumbnailPruneResult {
            removed_files: 0,
            removed_bytes: 0,
            total_bytes: 0,
        });
    }

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let mut removed_files = 0usize;
    let mut removed_bytes = 0u64;

    files.retain(|file| {
        let is_expired = file
            .modified_secs
            .map(|modified| now_secs.saturating_sub(modified) > THUMBNAIL_CACHE_MAX_AGE_SECS)
            .unwrap_or(false);
        if !is_expired {
            return true;
        }

        if fs::remove_file(&file.path).is_ok() {
            removed_files += 1;
            removed_bytes = removed_bytes.saturating_add(file.size);
            return false;
        }

        true
    });

    let mut total_bytes = files.iter().map(|file| file.size).sum::<u64>();
    if total_bytes > THUMBNAIL_CACHE_MAX_BYTES {
        files.sort_by_key(|file| file.modified_secs.unwrap_or(0));
        for file in files {
            if total_bytes <= THUMBNAIL_CACHE_MAX_BYTES {
                break;
            }

            if fs::remove_file(&file.path).is_err() {
                continue;
            }

            removed_files += 1;
            removed_bytes = removed_bytes.saturating_add(file.size);
            total_bytes = total_bytes.saturating_sub(file.size);
        }
    }

    Ok(ThumbnailPruneResult {
        removed_files,
        removed_bytes,
        total_bytes,
    })
}

fn clear_cached_files(root: &Path) -> Result<ThumbnailClearResult, String> {
    let files = collect_cached_files(root)?;
    let removed_files = files.len();
    let removed_bytes = files.iter().map(|file| file.size).sum::<u64>();

    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(root).map_err(|error| error.to_string())?;

    Ok(ThumbnailClearResult {
        removed_files,
        removed_bytes,
    })
}

#[tauri::command]
pub fn thumbnail_resolve_batch(
    app: AppHandle,
    state: State<'_, ThumbnailState>,
    request: ThumbnailResolveBatchRequest,
) -> Result<ThumbnailResolveBatchResponse, String> {
    let cache_root = thumbnail_cache_root(&app)?;
    let shared_state = state.inner().clone();

    let results = request
        .items
        .into_iter()
        .map(|item| resolve_item(item, &cache_root, &shared_state))
        .collect::<Vec<_>>();

    pump_workers(app, shared_state);

    Ok(ThumbnailResolveBatchResponse { results })
}

#[tauri::command]
pub fn thumbnail_prune_cache(
    app: AppHandle,
    _state: State<'_, ThumbnailState>,
) -> Result<ThumbnailPruneResult, String> {
    let cache_root = thumbnail_cache_root(&app)?;
    prune_cached_files(&cache_root)
}

#[tauri::command]
pub fn thumbnail_clear_cache(
    app: AppHandle,
    _state: State<'_, ThumbnailState>,
) -> Result<ThumbnailClearResult, String> {
    let cache_root = thumbnail_cache_root(&app)?;
    clear_cached_files(&cache_root)
}

#[cfg(test)]
mod tests;
