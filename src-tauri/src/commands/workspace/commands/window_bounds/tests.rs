use super::{
  cascaded_bounds, default_window_bounds, keep_on_screen, read_saved_window_bounds,
  write_saved_window_bounds, Screens, CASCADE_OFFSET,
};
use crate::commands::workspace::types::WindowBounds;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};
use tauri::{PhysicalPosition, PhysicalRect, PhysicalSize};

fn unique_test_file(prefix: &str) -> std::path::PathBuf {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("clock should be monotonic")
    .as_nanos();
  env::temp_dir().join(format!("{prefix}-{timestamp}.json"))
}

fn rect(x: i32, y: i32, width: u32, height: u32) -> PhysicalRect<i32, u32> {
  PhysicalRect {
    position: PhysicalPosition::new(x, y),
    size: PhysicalSize::new(width, height),
  }
}

fn bounds(x: i32, y: i32, width: u32, height: u32, maximized: bool) -> WindowBounds {
  WindowBounds { x, y, width, height, maximized }
}

/// A 1920x1040 primary work area at 150% and a monitor to its left.
fn two_screens() -> Screens {
  Screens {
    work_areas: vec![rect(0, 0, 1920, 1040), rect(-1280, 100, 1280, 984)],
    primary_work_area: rect(0, 0, 1920, 1040),
    primary_scale_factor: 1.5,
  }
}

#[test]
fn read_saved_window_bounds_returns_none_for_missing_or_invalid_file() {
  let path = unique_test_file("window-bounds-missing");
  assert_eq!(read_saved_window_bounds(&path), None);

  fs::write(&path, "not json").expect("file should be written");
  assert_eq!(read_saved_window_bounds(&path), None);

  fs::remove_file(&path).expect("file should be removed");
}

#[test]
fn saved_window_bounds_round_trip_through_file() {
  let path = unique_test_file("window-bounds-round-trip");
  let saved = bounds(-1200, 150, 900, 700, true);

  write_saved_window_bounds(&path, &saved).expect("bounds should be written");
  assert_eq!(read_saved_window_bounds(&path), Some(saved));

  fs::remove_file(&path).expect("file should be removed");
}

#[test]
fn saved_window_bounds_without_maximized_read_as_not_maximized() {
  let path = unique_test_file("window-bounds-no-maximized");
  fs::write(&path, r#"{ "x": 10, "y": 20, "width": 800, "height": 600 }"#).expect("file should be written");

  assert_eq!(read_saved_window_bounds(&path), Some(bounds(10, 20, 800, 600, false)));

  fs::remove_file(&path).expect("file should be removed");
}

#[test]
fn keep_on_screen_keeps_bounds_whose_grip_is_on_a_secondary_monitor() {
  let left_monitor = bounds(-1200, 150, 900, 700, false);
  // Mostly off the left monitor, but the top centre of the tab strip is still on it.
  let hanging_off = bounds(-1700, 90, 1000, 700, true);

  assert_eq!(keep_on_screen(left_monitor.clone(), &two_screens()), left_monitor);
  assert_eq!(keep_on_screen(hanging_off.clone(), &two_screens()), hanging_off);
}

#[test]
fn keep_on_screen_moves_bounds_on_a_removed_monitor_to_the_primary_default() {
  let on_removed_monitor = bounds(2200, 100, 900, 700, true);
  // Above the left monitor's work area: the grip point is off every monitor.
  let above_left_monitor = bounds(-1200, 50, 900, 700, false);

  assert_eq!(
    keep_on_screen(on_removed_monitor, &two_screens()),
    WindowBounds {
      maximized: true,
      ..default_window_bounds(&two_screens())
    },
  );
  assert_eq!(
    keep_on_screen(above_left_monitor, &two_screens()),
    default_window_bounds(&two_screens()),
  );
}

#[test]
fn default_window_bounds_scales_and_centres_in_the_primary_work_area() {
  assert_eq!(default_window_bounds(&two_screens()), bounds(135, 0, 1650, 1040, false));

  let small_screen = Screens {
    work_areas: vec![rect(100, 50, 1000, 700)],
    primary_work_area: rect(100, 50, 1000, 700),
    primary_scale_factor: 1.0,
  };
  assert_eq!(default_window_bounds(&small_screen), bounds(100, 50, 1000, 700, false));

  let roomy_screen = Screens {
    work_areas: vec![rect(0, 0, 2560, 1400)],
    primary_work_area: rect(0, 0, 2560, 1400),
    primary_scale_factor: 1.0,
  };
  assert_eq!(default_window_bounds(&roomy_screen), bounds(730, 310, 1100, 780, false));
}

#[test]
fn cascaded_bounds_offsets_the_position_and_keeps_size_and_maximized() {
  assert_eq!(
    cascaded_bounds(&bounds(100, 200, 900, 700, true)),
    bounds(100 + CASCADE_OFFSET, 200 + CASCADE_OFFSET, 900, 700, true),
  );
}
