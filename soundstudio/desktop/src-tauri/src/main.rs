// SoundStudio desktop. The window loads the live website, so the app and the
// browser version are always the same code and can share rooms; audio in and
// out is native (Core Audio on Mac, WASAPI on Windows) for the lowest delay.
// The page is served through the app's local server and finds the native audio
// through window.__SS_NATIVE (native.rs, app/audio/native-io.js).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod native;

use tauri::{WebviewUrl, WebviewWindowBuilder};

pub const SITE: &str = "https://soundstudio-wine.vercel.app/";

fn main() {
    let (port, token) = native::serve().expect("couldn't start the local audio link");
    tauri::Builder::default()
        .setup(move |app| {
            // the live site, served through the app's local server (see native.rs)
            let url = WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse().expect("bad local URL"));
            WebviewWindowBuilder::new(app, "main", url)
                .title("SoundStudio")
                .inner_size(1280.0, 840.0)
                .min_inner_size(420.0, 600.0)
                .initialization_script(&format!("window.__SS_NATIVE = {{ port: {port}, token: '{token}', version: '{}' }};", env!("CARGO_PKG_VERSION")))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SoundStudio");
}
