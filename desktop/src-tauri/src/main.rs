// AI MediaLab — coque de bureau.
//
// Rôle : lancer le serveur Python embarqué (runtime/python + backend), attendre qu'il réponde, puis
// afficher l'interface dans la fenêtre. À la fermeture, arrêter proprement tout l'arbre de processus
// (serveur + worker de génération, qui peut tenir des dizaines de Go de mémoire).
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

/// Positionné par le gestionnaire de signaux (SIGTERM/SIGINT/SIGHUP) ; surveillé par un thread qui
/// demande alors une sortie normale — ce qui arrête le serveur et le worker (sinon ils resteraient orphelins).
static SIGNALED: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn on_signal(_sig: libc::c_int) {
    SIGNALED.store(true, Ordering::SeqCst);
}

fn main() {
    // Linux : le moteur de rendu DMA-BUF de WebKitGTK affiche une fenêtre vide ou plante avec certains pilotes
    // NVIDIA propriétaires (cas d'usage principal de cette version). Désactivé sauf demande explicite.
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
        // Une seule instance : un second lancement ramène la fenêtre existante au premier plan.
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

            // Fenêtre créée ici (et non dans tauri.conf.json) pour pouvoir brancher le gestionnaire de
            // téléchargements : sans lui, WKWebView ignore les liens <a download>.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("AI MediaLab")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .center()
                .theme(Some(Theme::Dark))
                .background_color(Color(13, 11, 10, 255))
                // Sinon Tauri intercepte les fichiers déposés et le glisser-déposer HTML5 de l'interface ne reçoit rien.
                .disable_drag_drop_handler()
                .on_download(move |webview, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            // Destination par défaut de wry : dossier Téléchargements, nom suggéré, sans écrasement.
                            shell_log(&logs_dir, &format!("téléchargement demandé : {url} → {}", destination.display()));
                            *last_destination.lock().unwrap() = destination.display().to_string();
                        }
                        DownloadEvent::Finished { url, path, success } => {
                            // Sur macOS, l'événement ne renseigne pas toujours le chemin : on retombe sur la destination demandée.
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

// --- Journal de la coque et notifications ----------------------------------------------------------

fn shell_log(logs_dir: &Path, line: &str) {
    let _ = fs::create_dir_all(logs_dir);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(logs_dir.join("shell.log")) {
        let _ = writeln!(f, "{line}");
    }
}

/// Notifie la page : événement `cn-download` (l'interface peut l'écouter et poser `window.__cnHandlesDownloads = true`),
/// sinon petite bulle de secours.
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

// --- Écran de démarrage ----------------------------------------------------------------------------

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

// --- Démarrage du backend --------------------------------------------------------------------------

/// Dossier contenant backend/, frontend/ et runtime/. `AI_MEDIALAB_RESOURCES` permet de pointer
/// vers desktop/build/resources en développement (`tauri dev`).
fn resources_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Some(p) = env::var_os("AI_MEDIALAB_RESOURCES") {
        return Some(PathBuf::from(p));
    }
    // Distribution « portable » (Windows/Linux) : backend/, frontend/ et runtime/ sont à côté de l'exécutable.
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
    // L'application est volontairement passée en dernier : ainsi un `pkill -f "uvicorn app.main:app"`
    // lancé pour redémarrer un serveur de développement ne tue pas le serveur embarqué.
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
    // Permet au serveur de s'arrêter seul si la coque disparaît brutalement (kill -9, plantage).
    .env("IMAGEGEN_PARENT_PID", std::process::id().to_string())
    .stdin(Stdio::null())
    .stdout(Stdio::from(log))
    .stderr(Stdio::from(log_err));

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // nouveau groupe : on pourra signaler serveur + worker d'un coup
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    cmd.spawn().map_err(|e| format!("Lancement du serveur impossible : {e}"))
}

/// Filet de sécurité (Unix) : processus indépendant qui surveille la coque et, si elle disparaît sans
/// passer par l'arrêt normal (SIGKILL, plantage), arrête tout le groupe du serveur — y compris le worker de
/// génération, qui peut tenir des dizaines de Go. Se termine seul quand le groupe n'existe plus.
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

/// Windows : le serveur et le worker de génération (qui peut tenir des dizaines de Go) sont placés dans un
/// « Job Object » configuré KILL_ON_JOB_CLOSE : si la coque disparaît (plantage, fin de tâche), Windows ferme
/// le job et tue tout l'arbre — l'équivalent de la sentinelle Unix.
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

    // Conservé pour toute la vie du processus : sa fermeture (par Windows) déclenche l'arrêt de l'arbre.
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
                return; // pas de job : on se rabat sur taskkill à la fermeture normale
            }
            JOB.store(job as isize, Ordering::SeqCst);
        }
    }
}

fn boot(app: AppHandle) {
    // Laisse la webview charger l'écran de démarrage avant d'y envoyer des messages.
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
    // Migration : avant le renommage en « AI MediaLab », les données vivaient dans le dossier de l'ancien identifiant.
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

        // Le serveur s'est-il arrêté ?
        let exited = {
            let state = app.state::<Backend>();
            let mut guard = state.0.lock().unwrap();
            match guard.as_mut() {
                None => return, // arrêt demandé pendant le démarrage
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

    // Prêt : on remplace l'écran de démarrage par l'interface.
    let splash_url = app
        .get_webview_window("main")
        .and_then(|w| w.url().ok())
        .map(|u| u.to_string());
    eval(&app, format!("window.location.replace({})", js_str(&format!("http://127.0.0.1:{port}/"))));

    // Auto-test des téléchargements (développement) : CN_SELFTEST_DOWNLOAD=1 déclenche un <a download> programmatique.
    if env::var_os("CN_SELFTEST_DOWNLOAD").is_some() {
        thread::sleep(Duration::from_secs(4));
        eval(
            &app,
            r#"(function(){var a=document.createElement("a");a.href="/api/status";a.download="cn-selftest.json";document.body.appendChild(a);a.click();a.remove();})()"#
                .to_string(),
        );
    }

    // Surveillance : si le serveur meurt en cours de route, on revient à l'écran de démarrage avec le journal.
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

// --- Arrêt -----------------------------------------------------------------------------------------

fn stop_backend(app: &AppHandle) {
    let Some(state) = app.try_state::<Backend>() else { return };
    let Some(mut child) = state.0.lock().unwrap().take() else { return };
    let pid = child.id();

    #[cfg(unix)]
    {
        // Signal au groupe entier : serveur + worker de génération.
        unsafe { libc::kill(-(pid as i32), libc::SIGTERM) };
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                // Le serveur est parti ; on s'assure qu'aucun enfant ne traîne.
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
