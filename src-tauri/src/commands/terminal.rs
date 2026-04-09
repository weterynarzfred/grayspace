use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, State};

const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
const TERMINAL_EXIT_EVENT: &str = "terminal-exit";

#[derive(Default)]
pub struct TerminalState {
  sessions: Mutex<HashMap<String, TerminalSession>>,
  queued_commands: Mutex<HashMap<String, Vec<String>>>,
}

struct TerminalSession {
  child: Box<dyn portable_pty::Child + Send>,
  writer: Arc<Mutex<Box<dyn Write + Send>>>,
  master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
  output_thread: Option<JoinHandle<()>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
  session_id: String,
  data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
  session_id: String,
  code: i32,
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
  PtySize {
    cols: cols.max(2),
    rows: rows.max(1),
    pixel_width: 0,
    pixel_height: 0,
  }
}

fn terminal_lock_error() -> String {
  "Terminal session state is unavailable.".to_string()
}

fn terminal_not_running_error() -> String {
  "Terminal session is not running.".to_string()
}

fn empty_terminal_command_error() -> String {
  "Terminal command cannot be empty.".to_string()
}

fn normalize_terminal_command(command: String) -> Result<String, String> {
  if command.trim().is_empty() {
    return Err(empty_terminal_command_error());
  }

  if command.ends_with('\n') {
    return Ok(command);
  }

  Ok(format!("{command}\n"))
}

fn escape_single_quotes(value: &str) -> String {
  value.replace('\'', "'\\''")
}

#[cfg(target_os = "windows")]
fn shell_command_path() -> &'static str {
  r"C:\Program Files\Git\bin\bash.exe"
}

#[cfg(not(target_os = "windows"))]
fn shell_command_path() -> &'static str {
  "/bin/bash"
}

#[cfg(target_os = "windows")]
fn path_for_shell(path: &Path) -> String {
  let normalized = path.to_string_lossy().replace('\\', "/");
  let chars: Vec<char> = normalized.chars().collect();

  if chars.len() >= 2 && chars[1] == ':' && chars[0].is_ascii_alphabetic() {
    let drive_letter = chars[0].to_ascii_lowercase();
    let rest: String = chars.into_iter().skip(2).collect();
    let trimmed_rest = rest.trim_start_matches('/');

    if trimmed_rest.is_empty() {
      return format!("/{drive_letter}");
    }

    return format!("/{drive_letter}/{trimmed_rest}");
  }

  normalized
}

#[cfg(not(target_os = "windows"))]
fn path_for_shell(path: &Path) -> String {
  path.to_string_lossy().to_string()
}

fn maybe_existing_dir(path: Option<String>) -> Option<PathBuf> {
  let path = path?;
  let path_buf = PathBuf::from(path);
  if path_buf.is_dir() {
    Some(path_buf)
  } else {
    None
  }
}

fn emit_terminal_output(app_handle: &AppHandle, session_id: String, data: String) {
  let _ = app_handle.emit(
    TERMINAL_OUTPUT_EVENT,
    TerminalOutputPayload { session_id, data },
  );
}

fn emit_terminal_exit(app_handle: &AppHandle, session_id: String, code: i32) {
  let _ = app_handle.emit(
    TERMINAL_EXIT_EVENT,
    TerminalExitPayload { session_id, code },
  );
}

fn session_writer(
  state: &State<TerminalState>,
  session_id: &str,
) -> Result<Arc<Mutex<Box<dyn Write + Send>>>, String> {
  let guard = state.sessions.lock().map_err(|_| terminal_lock_error())?;
  guard
    .get(session_id)
    .map(|session| Arc::clone(&session.writer))
    .ok_or_else(terminal_not_running_error)
}

fn write_to_writer(writer: Arc<Mutex<Box<dyn Write + Send>>>, data: &str) -> Result<(), String> {
  let mut writer_guard = writer
    .lock()
    .map_err(|_| "Terminal input stream is unavailable.".to_string())?;
  writer_guard
    .write_all(data.as_bytes())
    .map_err(|error| error.to_string())?;
  writer_guard.flush().map_err(|error| error.to_string())
}

fn write_to_session(
  state: &State<TerminalState>,
  session_id: &str,
  data: &str,
) -> Result<(), String> {
  let writer = session_writer(state, session_id)?;
  write_to_writer(writer, data)
}

fn queue_session_command(
  state: &State<TerminalState>,
  session_id: &str,
  command: String,
) -> Result<(), String> {
  let mut queued_commands = state
    .queued_commands
    .lock()
    .map_err(|_| terminal_lock_error())?;
  queued_commands
    .entry(session_id.to_string())
    .or_default()
    .push(command);
  Ok(())
}

fn drain_queued_commands(
  state: &State<TerminalState>,
  session_id: &str,
) -> Result<Vec<String>, String> {
  let mut queued_commands = state
    .queued_commands
    .lock()
    .map_err(|_| terminal_lock_error())?;
  Ok(queued_commands.remove(session_id).unwrap_or_default())
}

pub fn stop_terminal_session_by_id(
  state: &State<TerminalState>,
  session_id: &str,
) -> Result<(), String> {
  {
    let mut queued_commands = state
      .queued_commands
      .lock()
      .map_err(|_| terminal_lock_error())?;
    queued_commands.remove(session_id);
  }

  let mut maybe_session = {
    let mut guard = state.sessions.lock().map_err(|_| terminal_lock_error())?;
    guard.remove(session_id)
  };

  if let Some(mut active_session) = maybe_session.take() {
    let _ = active_session.child.kill();
    active_session.output_thread.take();
  }

  Ok(())
}

#[tauri::command]
pub fn terminal_start(
  app_handle: AppHandle,
  state: State<TerminalState>,
  session_id: String,
  cwd: Option<String>,
  cols: u16,
  rows: u16,
) -> Result<(), String> {
  let should_restart = {
    let mut guard = state.sessions.lock().map_err(|_| terminal_lock_error())?;
    if let Some(existing_session) = guard.get_mut(&session_id) {
      match existing_session.child.try_wait() {
        Ok(None) => return Ok(()),
        Ok(Some(_)) => true,
        Err(_) => true,
      }
    } else {
      false
    }
  };

  if should_restart {
    stop_terminal_session_by_id(&state, &session_id)?;
  }

  let pty_system = native_pty_system();
  let pty_pair = pty_system
    .openpty(terminal_size(cols, rows))
    .map_err(|error| error.to_string())?;

  let mut shell_command = CommandBuilder::new(shell_command_path());
  shell_command.arg("--login");
  shell_command.arg("-i");

  if let Some(start_dir) = maybe_existing_dir(cwd) {
    shell_command.cwd(start_dir);
  }

  let child = pty_pair
    .slave
    .spawn_command(shell_command)
    .map_err(|error| error.to_string())?;
  drop(pty_pair.slave);

  let mut reader = pty_pair
    .master
    .try_clone_reader()
    .map_err(|error| error.to_string())?;
  let writer = pty_pair
    .master
    .take_writer()
    .map_err(|error| error.to_string())?;
  let master = pty_pair.master;

  let output_app_handle = app_handle.clone();
  let output_session_id = session_id.clone();
  let output_thread = std::thread::spawn(move || {
    let mut buffer = [0_u8; 8192];

    loop {
      match reader.read(&mut buffer) {
        Ok(0) => {
          emit_terminal_exit(&output_app_handle, output_session_id.clone(), 0);
          break;
        }
        Ok(size) => {
          let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
          emit_terminal_output(&output_app_handle, output_session_id.clone(), chunk);
        }
        Err(_) => {
          emit_terminal_exit(&output_app_handle, output_session_id.clone(), -1);
          break;
        }
      }
    }
  });

  let new_session = TerminalSession {
    child,
    writer: Arc::new(Mutex::new(writer)),
    master: Arc::new(Mutex::new(master)),
    output_thread: Some(output_thread),
  };

  let mut guard = state.sessions.lock().map_err(|_| terminal_lock_error())?;
  guard.insert(session_id.clone(), new_session);
  drop(guard);

  let queued_commands = drain_queued_commands(&state, &session_id)?;

  for queued_command in queued_commands {
    write_to_session(&state, &session_id, &queued_command)?;
  }

  Ok(())
}

#[tauri::command]
pub fn terminal_write(
  state: State<TerminalState>,
  session_id: String,
  data: String,
) -> Result<(), String> {
  write_to_session(&state, &session_id, &data)
}

#[tauri::command]
pub fn terminal_run_command(
  state: State<TerminalState>,
  session_id: String,
  command: String,
) -> Result<(), String> {
  let normalized_command = normalize_terminal_command(command)?;

  match write_to_session(&state, &session_id, &normalized_command) {
    Ok(()) => Ok(()),
    Err(error) if error == terminal_not_running_error() => {
      queue_session_command(&state, &session_id, normalized_command)
    }
    Err(error) => Err(error),
  }
}

#[tauri::command]
pub fn terminal_resize(
  state: State<TerminalState>,
  session_id: String,
  cols: u16,
  rows: u16,
) -> Result<(), String> {
  let master = {
    let guard = state.sessions.lock().map_err(|_| terminal_lock_error())?;
    guard
      .get(&session_id)
      .map(|session| Arc::clone(&session.master))
      .ok_or_else(terminal_not_running_error)?
  };

  let master_guard = master
    .lock()
    .map_err(|_| "Terminal PTY is unavailable.".to_string())?;
  master_guard
    .resize(terminal_size(cols, rows))
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_set_cwd(
  state: State<TerminalState>,
  session_id: String,
  path: String,
) -> Result<(), String> {
  let path_buf = PathBuf::from(&path);
  if !path_buf.is_dir() {
    return Err("Cannot switch terminal directory because the path is not a folder.".to_string());
  }

  let writer = {
    let guard = state.sessions.lock().map_err(|_| terminal_lock_error())?;
    guard
      .get(&session_id)
      .map(|session| Arc::clone(&session.writer))
      .ok_or_else(terminal_not_running_error)?
  };

  let shell_path = path_for_shell(&path_buf);
  let command = format!("cd -- '{}'\n", escape_single_quotes(&shell_path));
  write_to_writer(writer, &command)
}

#[tauri::command]
pub fn terminal_stop(state: State<TerminalState>, session_id: String) -> Result<(), String> {
  stop_terminal_session_by_id(&state, &session_id)
}

#[cfg(test)]
mod tests;
