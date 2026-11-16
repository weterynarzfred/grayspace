use std::fs;
use std::path::Path;

fn has_valid_extension_suffix(suffix: &str) -> bool {
  if suffix.is_empty() {
    return true;
  }
  if !suffix.starts_with('.') {
    return false;
  }
  suffix[1..].split('.').all(|segment| !segment.is_empty())
}

fn parse_incrementable_suffix(name: &str) -> Option<(String, u64, usize, String)> {
  let mut last_match: Option<(String, u64, usize, String)> = None;

  for (dot_index, character) in name.char_indices() {
    if character != '.' {
      continue;
    }

    let prefix = &name[..dot_index];
    if prefix.is_empty() {
      continue;
    }

    let remainder = &name[(dot_index + 1)..];
    let digits_len = remainder
      .chars()
      .take_while(|character| character.is_ascii_digit())
      .count();
    if digits_len < 3 {
      continue;
    }

    let digits = &remainder[..digits_len];
    let suffix = &remainder[digits_len..];
    if !has_valid_extension_suffix(suffix) {
      continue;
    }

    let number = digits.parse::<u64>().ok()?;
    last_match = Some((prefix.to_string(), number, digits.len(), suffix.to_string()));
  }

  last_match
}

fn split_name_for_fallback_suffix(name: &str) -> (String, String) {
  match name.rfind('.') {
    Some(dot_index) if dot_index > 0 => (
      name[..dot_index].to_string(),
      name[dot_index..].to_string(),
    ),
    _ => (name.to_string(), String::new()),
  }
}

fn build_next_collision_name(name: &str) -> String {
  if let Some((prefix, number, width, suffix)) = parse_incrementable_suffix(name) {
    let incremented = number.saturating_add(1);
    return format!("{prefix}.{incremented:0width$}{suffix}");
  }

  let (base_name, extension_suffix) = split_name_for_fallback_suffix(name);
  format!("{base_name}.001{extension_suffix}")
}

pub(super) fn path_conflicts_with_existing(candidate_path: &Path, source_canonical_path: &Path) -> bool {
  if !candidate_path.exists() {
    return false;
  }

  match fs::canonicalize(candidate_path) {
    Ok(candidate_canonical_path) => candidate_canonical_path != source_canonical_path,
    Err(_) => true,
  }
}

pub(super) fn resolve_non_conflicting_name(
  parent_path: &Path,
  requested_name: &str,
  source_canonical_path: &Path,
) -> String {
  let mut candidate_name = requested_name.to_string();
  loop {
    let candidate_path = parent_path.join(&candidate_name);
    if !path_conflicts_with_existing(&candidate_path, source_canonical_path) {
      return candidate_name;
    }
    candidate_name = build_next_collision_name(&candidate_name);
  }
}

pub(super) fn resolve_non_conflicting_create_name(parent_path: &Path, requested_name: &str) -> String {
  let mut candidate_name = requested_name.to_string();
  loop {
    let candidate_path = parent_path.join(&candidate_name);
    if !candidate_path.exists() {
      return candidate_name;
    }
    candidate_name = build_next_collision_name(&candidate_name);
  }
}
