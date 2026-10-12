// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// AI MediaLab desktop shell.
//
// Starts the bundled Python server (runtime/python + backend), waits until it answers, then shows the UI
// in the window. On exit it stops the whole process tree (server + generation worker, which can hold
// tens of GB of memory).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{
    webview::DownloadEvent, window::Color, AppHandle, Manager, RunEvent, Theme, WebviewUrl, WebviewWindowBuilder,
};

const BOOT_TIMEOUT: Duration = Duration::from_secs(240);
#[cfg(unix)]
const STOP_GRACE: Duration = Duration::from_secs(6);

struct Backend(Mutex<Option<Child>>);

/// Set by the signal handler (SIGTERM/SIGINT/SIGHUP). A watcher thread then requests a normal exit, which
/// stops the server and the worker (otherwise they would be orphaned).
static SIGNALED: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn on_signal(_sig: libc::c_int) {
    SIGNALED.store(true, Ordering::SeqCst);
}

fn main() {
    // Linux: WebKitGTK's DMA-BUF renderer shows a blank window or crashes with some proprietary NVIDIA
    // drivers (the main target here). Disabled unless explicitly set.
    #[cfg(target_os = "linux")]
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    #[cfg(unix)]
    unsafe {
        for sig in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::signal(sig, on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
        }
    }

    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Single instance: a second launch brings the existing window to the front.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .setup(|app| {
            app.manage(Backend(Mutex::new(None)));
            let logs_dir = app
                .path()
                .app_local_data_dir()
                .map(|d| d.join("logs"))
                .unwrap_or_else(|_| env::temp_dir());

            let handle_for_signals = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(200));
                if SIGNALED.load(Ordering::SeqCst) {
                    handle_for_signals.exit(0);
                    return;
                }
            });
            let last_destination: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

            // Window built here (not in tauri.conf.json) so we can hook the download handler;
            // without it WKWebView ignores <a download> links.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("AI MediaLab")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .center()
                .theme(Some(Theme::Dark))
                .background_color(Color(13, 11, 10, 255))
                // Otherwise Tauri intercepts dropped files and the UI's HTML5 drag and drop receives nothing.
                .disable_drag_drop_handler()
                .on_download(move |webview, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            // wry's default destination: Downloads folder, suggested name, no overwrite.
                            shell_log(&logs_dir, &format!("téléchargement demandé : {url} → {}", destination.display()));
                            *last_destination.lock().unwrap() = destination.display().to_string();
                        }
                        DownloadEvent::Finished { url, path, success } => {
                            // On macOS the event does not always carry the path: fall back to the requested destination.
                            let shown = path
                                .map(|p| p.display().to_string())
                                .unwrap_or_else(|| last_destination.lock().unwrap().clone());
                            shell_log(&logs_dir, &format!("téléchargement terminé : {url} → {shown} (succès : {success})"));
                            let _ = webview.eval(download_toast_js(&shown, success));
                        }
                        _ => {}
                    }
                    true
                })
                .build()?;

            let handle = app.handle().clone();
            thread::spawn(move || boot(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("échec de l'initialisation de l'application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_backend(app);
            }
        });
}

// --- Shell log and notifications ---

fn shell_log(logs_dir: &Path, line: &str) {
    let _ = fs::create_dir_all(logs_dir);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(logs_dir.join("shell.log")) {
        let _ = writeln!(f, "{line}");
    }
}

/// Notifies the page with a `cn-download` event (the UI can listen and set `window.__cnHandlesDownloads = true`),
/// otherwise shows a small fallback toast.
fn download_toast_js(path: &str, success: bool) -> String {
    format!(
        r#"(function(p, ok) {{
  window.dispatchEvent(new CustomEvent("cn-download", {{ detail: {{ path: p, success: ok }} }}));
  if (window.__cnHandlesDownloads) return;
  var name = p.split(/[\/]/).pop() || p;
  var d = document.createElement("div");
  d.textContent = (ok ? "Enregistré dans Téléchargements : " : "Échec du téléchargement : ") + name;
  d.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:10px 14px;border-radius:12px;" +
    "background:#221d1b;color:#efe8e1;border:1px solid #43392f;font:13px -apple-system,system-ui,sans-serif;" +
    "box-shadow:0 12px 40px rgba(0,0,0,.5);transition:opacity .4s";
  document.body.appendChild(d);
  setTimeout(function() {{ d.style.opacity = 0; setTimeout(function() {{ d.remove(); }}, 500); }}, 3500);
}})({}, {})"#,
        js_str(path),
        success
    )
}

// --- Splash screen ---

fn js_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn eval(app: &AppHandle, script: String) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&script);
    }
}

fn splash_status(app: &AppHandle, text: &str) {
    eval(app, format!("window.cnSplash && window.cnSplash.status({})", js_str(text)));
}

fn splash_error(app: &AppHandle, title: &str, detail: &str, log: &str) {
    eval(
        app,
        format!(
            "window.cnSplash && window.cnSplash.error({}, {}, {})",
            js_str(title),
            js_str(detail),
            js_str(log)
        ),
    );
}

// --- Backend startup ---

/// Folder holding backend/, frontend/ and runtime/. `AI_MEDIALAB_RESOURCES` can point to
/// desktop/build/resources during development (`tauri dev`).
fn resources_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Some(p) = env::var_os("AI_MEDIALAB_RESOURCES") {
        return Some(PathBuf::from(p));
    }
    // Portable layout (Windows/Linux): backend/, frontend/ and runtime/ sit next to the executable.
    if let Some(dir) = env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
        if python_path(&dir).is_file() {
            return Some(dir);
        }
    }
    app.path().resource_dir().ok()
}

fn python_path(res: &Path) -> PathBuf {
    if cfg!(windows) {
        res.join("runtime").join("python").join("python.exe")
    } else {
        res.join("runtime").join("python").join("bin").join("python3")
    }
}

fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn http_ok(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    if stream
        .write_all(b"GET /api/status HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 16];
    match stream.read(&mut buf) {
        Ok(n) => buf[..n].starts_with(b"HTTP/1.0 200") || buf[..n].starts_with(b"HTTP/1.1 200"),
        Err(_) => false,
    }
}

fn tail(path: &Path, max_lines: usize) -> String {
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(max_lines)..].join("\n")
}

fn spawn_backend(res: &Path, data_dir: &Path, log_path: &Path, port: u16) -> Result<Child, String> {
    let python = python_path(res);
    if !python.is_file() {
        return Err(format!("Python embarqué introuvable : {}", python.display()));
    }

    if let Some(dir) = log_path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Impossible de créer {} : {e}", dir.display()))?;
    }
    if log_path.exists() {
        let _ = fs::rename(log_path, log_path.with_file_name("backend.previous.log"));
    }
    let log: File = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| format!("Impossible d'ouvrir le journal {} : {e}", log_path.display()))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let sep = if cfg!(windows) { ";" } else { ":" };
    let pythonpath = format!(
        "{}{sep}{}",
        res.join("runtime").join("site-packages").display(),
        res.join("backend").display()
    );

    let mut cmd = Command::new(&python);
    // The app is passed last on purpose, so a `pkill -f "uvicorn app.main:app"` used to restart a dev
    // server does not kill the bundled one.
    cmd.args([
        "-m",
        "uvicorn",
        "--host",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "--timeout-graceful-shutdown",
        "3",
        "--no-access-log",
        "app.main:app",
    ])
    .current_dir(res.join("backend"))
    .env_remove("VIRTUAL_ENV")
    .env_remove("PYTHONHOME")
    .env("PYTHONPATH", OsString::from(pythonpath))
    .env("PYTHONNOUSERSITE", "1")
    .env("PYTHONUNBUFFERED", "1")
    .env("PYTHONDONTWRITEBYTECODE", "1")
    .env("PYTHONIOENCODING", "utf-8")
    .env("IMAGEGEN_DATA_DIR", data_dir)
    // Lets the server stop by itself if the shell dies abruptly (kill -9, crash).
    .env("IMAGEGEN_PARENT_PID", std::process::id().to_string())
    .stdin(Stdio::null())
    .stdout(Stdio::from(log))
    .stderr(Stdio::from(log_err));

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // new group, so server + worker can be signalled at once
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    cmd.spawn().map_err(|e| format!("Lancement du serveur impossible : {e}"))
}

/// Safety net (Unix): an independent process watches the shell and, if it vanishes without a normal
/// shutdown (SIGKILL, crash), stops the whole server group, including the generation worker that can hold
/// tens of GB. Exits on its own once the group is gone.
#[cfg(unix)]
fn spawn_sentinel(shell_pid: u32, backend_pgid: u32) {
    use std::os::unix::process::CommandExt;
    const SCRIPT: &str = r#"
while kill -0 "$1" 2>/dev/null; do
  kill -s 0 -- "-$2" 2>/dev/null || exit 0
  sleep 1
done
kill -s 0 -- "-$2" 2>/dev/null || exit 0
kill -s TERM -- "-$2" 2>/dev/null
sleep 6
kill -s KILL -- "-$2" 2>/dev/null
"#;
    let _ = Command::new("/bin/sh")
        .args(["-c", SCRIPT, "ai-medialab-sentinel", &shell_pid.to_string(), &backend_pgid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
}

/// Windows: the server and the generation worker (which can hold tens of GB) go into a Job Object with
/// KILL_ON_JOB_CLOSE. If the shell dies (crash, task kill) Windows closes the job and kills the whole tree,
/// the equivalent of the Unix sentinel.
#[cfg(windows)]
mod winjob {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::sync::atomic::{AtomicIsize, Ordering};

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // Kept for the whole process lifetime: Windows closing it triggers the tree shutdown.
    static JOB: AtomicIsize = AtomicIsize::new(0);

    pub fn attach(child: &Child) {
        unsafe {
            let job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 || AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0 {
                return; // no job: fall back to taskkill on normal shutdown
            }
            JOB.store(job as isize, Ordering::SeqCst);
        }
    }
}

fn boot(app: AppHandle) {
    // Let the webview load the splash screen before sending it messages.
    thread::sleep(Duration::from_millis(900));

    let Some(res) = resources_dir(&app) else {
        splash_error(&app, "Ressources introuvables", "Le dossier des ressources de l'application est inaccessible.", "");
        return;
    };
    let data_dir = match app.path().app_local_data_dir() {
        Ok(d) => d,
        Err(e) => {
            splash_error(&app, "Dossier de données inaccessible", &e.to_string(), "");
            return;
        }
    };
    // Migration: before the rename to "AI MediaLab", data lived in the old identifier's folder.
    if let Some(parent) = data_dir.parent() {
        let legacy = parent.join("app.chambrenoire.studio");
        if legacy.is_dir() && !data_dir.exists() {
            let _ = fs::rename(&legacy, &data_dir);
        }
    }
    let _ = fs::create_dir_all(&data_dir);
    let log_path = data_dir.join("logs").join("backend.log");

    let port = match free_port() {
        Ok(p) => p,
        Err(e) => {
            splash_error(&app, "Aucun port local disponible", &e.to_string(), "");
            return;
        }
    };

    splash_status(&app, "Démarrage du moteur…");
    let child = match spawn_backend(&res, &data_dir, &log_path, port) {
        Ok(c) => c,
        Err(msg) => {
            splash_error(&app, "Le serveur n'a pas pu démarrer", &msg, &tail(&log_path, 40));
            return;
        }
    };
    #[cfg(unix)]
    spawn_sentinel(std::process::id(), child.id());
    #[cfg(windows)]
    winjob::attach(&child);
    app.state::<Backend>().0.lock().unwrap().replace(child);

    let started = Instant::now();
    let mut announced = false;
    loop {
        thread::sleep(Duration::from_millis(250));

        // Did the server exit?
        let exited = {
            let state = app.state::<Backend>();
            let mut guard = state.0.lock().unwrap();
            match guard.as_mut() {
                None => return, // shutdown requested during startup
                Some(c) => c.try_wait().ok().flatten(),
            }
        };
        if let Some(status) = exited {
            splash_error(
                &app,
                "Le serveur s'est arrêté au démarrage",
                &format!("Code de sortie : {status}. Journal complet : {}", log_path.display()),
                &tail(&log_path, 40),
            );
            return;
        }

        if http_ok(port) {
            break;
        }
        if started.elapsed() > BOOT_TIMEOUT {
            splash_error(
                &app,
                "Le serveur ne répond pas",
                &format!("Aucune réponse après {} s. Journal : {}", BOOT_TIMEOUT.as_secs(), log_path.display()),
                &tail(&log_path, 40),
            );
            return;
        }
        if !announced && started.elapsed() > Duration::from_secs(8) {
            announced = true;
            splash_status(&app, "Premier démarrage, chargement des bibliothèques…");
        }
    }

    // Ready: replace the splash screen with the UI.
    let splash_url = app
        .get_webview_window("main")
        .and_then(|w| w.url().ok())
        .map(|u| u.to_string());
    eval(&app, format!("window.location.replace({})", js_str(&format!("http://127.0.0.1:{port}/"))));

    // Download self-test (dev): CN_SELFTEST_DOWNLOAD=1 triggers a programmatic <a download>.
    if env::var_os("CN_SELFTEST_DOWNLOAD").is_some() {
        thread::sleep(Duration::from_secs(4));
        eval(
            &app,
            r#"(function(){var a=document.createElement("a");a.href="/api/status";a.download="cn-selftest.json";document.body.appendChild(a);a.click();a.remove();})()"#
                .to_string(),
        );
    }

    // Watchdog: if the server dies mid-session, go back to the splash screen with the log.
    loop {
        thread::sleep(Duration::from_secs(1));
        let state = app.state::<Backend>();
        let mut guard = state.0.lock().unwrap();
        let Some(child) = guard.as_mut() else { return };
        if let Ok(Some(status)) = child.try_wait() {
            guard.take();
            drop(guard);
            if let Some(url) = splash_url {
                eval(&app, format!("window.location.replace({})", js_str(&url)));
                thread::sleep(Duration::from_millis(900));
            }
            splash_error(
                &app,
                "Le serveur s'est arrêté",
                &format!("Code de sortie : {status}. Fermez puis relancez l'application. Journal : {}", log_path.display()),
                &tail(&log_path, 40),
            );
            return;
        }
    }
}

// --- Shutdown ---

fn stop_backend(app: &AppHandle) {
    let Some(state) = app.try_state::<Backend>() else { return };
    let Some(mut child) = state.0.lock().unwrap().take() else { return };
    let pid = child.id();

    #[cfg(unix)]
    {
        // Signal the whole group: server + generation worker.
        unsafe { libc::kill(-(pid as i32), libc::SIGTERM) };
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                // The server is gone; make sure no child lingers.
                unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
        let _ = child.wait();
    }

    #[cfg(windows)]
    {
        let _ = child.try_wait();
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output();
        let _ = child.wait();
    }
}
