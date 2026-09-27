// SoundStudio desktop. The window shows the same jam room as the website; audio
// in and out is native (Core Audio on Mac, WASAPI on Windows) for the lowest
// delay. The page talks to the native audio over a private local WebSocket
// (see native.rs and web/native-io.js); video, rooms and the band stay in the page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod native;

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let (port, token) = native::serve().expect("couldn't start the local audio link");
    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("SoundStudio")
                .inner_size(1280.0, 840.0)
                .min_inner_size(420.0, 600.0)
                .initialization_script(&format!("window.__SS_NATIVE = {{ port: {port}, token: '{token}' }};"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SoundStudio");
}
