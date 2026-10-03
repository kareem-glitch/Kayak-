// airband desktop. The window loads the live website, so the app and the
// browser version are always the same code and can share rooms; audio in and
// out is native (Core Audio on Mac, WASAPI on Windows) for the lowest delay.
// The page is served through the app's local server and finds the native audio
// through window.__SS_NATIVE (native.rs, app/audio/native-io.js).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod native;
mod plugin;
mod direct;
mod update;

#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};

pub const SITE: &str = "https://air.band/";

fn main() {
    let (port, token) = native::serve().expect("couldn't start the local audio link");
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            fresh_permissions(app);
            update::start(app.handle().clone());
            // the live site, served through the app's local server (see native.rs)
            let url = WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse().expect("bad local URL"));
            WebviewWindowBuilder::new(app, "main", url)
                .title("airband")
                .inner_size(1280.0, 840.0)
                .min_inner_size(420.0, 600.0)
                .initialization_script(&format!("window.__SS_NATIVE = {{ port: {port}, token: '{token}', version: '{}' }};", env!("CARGO_PKG_VERSION")))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running airband")
        .run(|_, event| { if let RunEvent::Exit = event { update::install_on_quit(); } });
}

/// The Mac app is ad-hoc signed, so macOS ties the microphone and camera
/// permission to this exact build: after an update the old "allowed" stays in
/// System Settings but no longer applies, and macOS doesn't ask again (silent
/// mic, no camera). Once per version, clear the app's own entries so macOS asks.
#[cfg(target_os = "macos")]
fn fresh_permissions(app: &tauri::App) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let marker = dir.join("permissions-version");
    let v = env!("CARGO_PKG_VERSION");
    if std::fs::read_to_string(&marker).map(|s| s.trim() == v).unwrap_or(false) { return; }
    for service in ["Microphone", "Camera"] {
        let _ = std::process::Command::new("/usr/bin/tccutil").args(["reset", service, app.config().identifier.as_str()]).status();
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&marker, v);
}
