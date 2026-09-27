// SoundStudio desktop. The window loads the live website, so the app and the
// browser version are always the same code and can share rooms; audio in and
// out is native (Core Audio on Mac, WASAPI on Windows) for the lowest delay.
// The page finds the native audio through window.__SS_NATIVE and talks to it
// over a private local WebSocket (native.rs, app/audio/native-io.js).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod native;

use tauri::{WebviewUrl, WebviewWindowBuilder};

const SITE: &str = "https://soundstudio-wine.vercel.app/";

fn main() {
    let (port, token) = native::serve().expect("couldn't start the local audio link");
    tauri::Builder::default()
        .setup(move |app| {
            let site = std::env::var("SOUNDSTUDIO_URL").unwrap_or_else(|_| SITE.to_string());
            let url = WebviewUrl::External(site.parse().expect("bad site URL"));
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
