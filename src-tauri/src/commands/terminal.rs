use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, State};

const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
const TERMINAL_EXIT_EVENT: &str = "terminal-exit";

#[derive(Default)]
pub struct TerminalState {
    session: Mutex<Option<TerminalSession>>,
}

struct TerminalSession {
    child: Box<dyn portable_pty::Child + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    output_thread: Option<JoinHandle<()>>,
}

#[derive(Serialize, Clone)]
struct TerminalOutputPayload {
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExitPayload {
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

fn emit_terminal_output(app_handle: &AppHandle, data: String) {
    let _ = app_handle.emit(TERMINAL_OUTPUT_EVENT, TerminalOutputPayload { data });
}

fn emit_terminal_exit(app_handle: &AppHandle, code: i32) {
    let _ = app_handle.emit(TERMINAL_EXIT_EVENT, TerminalExitPayload { code });
}

fn stop_terminal_session(state: &State<TerminalState>) -> Result<(), String> {
    let mut session = {
        let mut guard = state.session.lock().map_err(|_| terminal_lock_error())?;
        guard.take()
    };

    if let Some(mut active_session) = session.take() {
        let _ = active_session.child.kill();
        active_session.output_thread.take();
    }

    Ok(())
}

#[tauri::command]
pub fn terminal_start(
    app_handle: AppHandle,
    state: State<TerminalState>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    stop_terminal_session(&state)?;

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
    let output_thread = std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    emit_terminal_exit(&output_app_handle, 0);
                    break;
                }
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                    emit_terminal_output(&output_app_handle, chunk);
                }
                Err(_) => {
                    emit_terminal_exit(&output_app_handle, -1);
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

    let mut guard = state.session.lock().map_err(|_| terminal_lock_error())?;
    *guard = Some(new_session);
    Ok(())
}

#[tauri::command]
pub fn terminal_write(state: State<TerminalState>, data: String) -> Result<(), String> {
    let writer = {
        let guard = state.session.lock().map_err(|_| terminal_lock_error())?;
        guard
            .as_ref()
            .map(|session| Arc::clone(&session.writer))
            .ok_or_else(terminal_not_running_error)?
    };

    let mut writer_guard = writer
        .lock()
        .map_err(|_| "Terminal input stream is unavailable.".to_string())?;
    writer_guard
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    writer_guard.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_resize(state: State<TerminalState>, cols: u16, rows: u16) -> Result<(), String> {
    let master = {
        let guard = state.session.lock().map_err(|_| terminal_lock_error())?;
        guard
            .as_ref()
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
pub fn terminal_set_cwd(state: State<TerminalState>, path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(
            "Cannot switch terminal directory because the path is not a folder.".to_string(),
        );
    }

    let writer = {
        let guard = state.session.lock().map_err(|_| terminal_lock_error())?;
        guard
            .as_ref()
            .map(|session| Arc::clone(&session.writer))
            .ok_or_else(terminal_not_running_error)?
    };

    let shell_path = path_for_shell(&path_buf);
    let command = format!("cd -- '{}'\n", escape_single_quotes(&shell_path));

    let mut writer_guard = writer
        .lock()
        .map_err(|_| "Terminal input stream is unavailable.".to_string())?;
    writer_guard
        .write_all(command.as_bytes())
        .map_err(|error| error.to_string())?;
    writer_guard.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_stop(state: State<TerminalState>) -> Result<(), String> {
    stop_terminal_session(&state)
}
