//! Auto-update. On start the app asks air.band whether there's a newer version
//! (download/latest.json, signed with the release key), downloads it in the
//! background and tells the page, which offers "Restart now". Otherwise it's put
//! in place when you quit, so an update never interrupts a jam.
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

static READY: Mutex<Option<(Update, Vec<u8>)>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn start(app: AppHandle) {
    let _ = APP.set(app.clone());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = fetch(&app).await { eprintln!("update check: {e}"); }
    });
}

async fn fetch(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(up) = app.updater()?.check().await? else { return Ok(()) };
    let bytes = up.download(|_, _| {}, || {}).await?;
    *READY.lock().unwrap() = Some((up, bytes));
    Ok(())
}

/// The version downloaded and waiting to be installed, if any (sent to the page with the stats).
pub fn ready() -> Option<String> { READY.lock().unwrap().as_ref().map(|(u, _)| u.version.clone()) }

/// "Restart now" in the page: install and start the new version.
pub fn install_now() -> Result<(), String> {
    let Some((up, bytes)) = READY.lock().unwrap().take() else { return Err("No update is ready".into()) };
    up.install(bytes).map_err(|e| e.to_string())?;   // Windows: the installer takes over and reopens the app
    if let Some(app) = APP.get() { app.restart(); }
    Ok(())
}

/// Quitting: put the downloaded version in place for next time.
pub fn install_on_quit() {
    let r = READY.lock().unwrap().take();
    if let Some((up, bytes)) = r { if let Err(e) = up.install(bytes) { eprintln!("update install: {e}"); } }
}
