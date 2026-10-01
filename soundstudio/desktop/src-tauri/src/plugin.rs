// The air.band plugin: drop it on a track in your DAW and that track becomes
// your input here, with your whole chain (amp sims, pedals, anything). It
// streams to this app over your own computer only (see ssengine::link).
//  - While the plugin is streaming it replaces your audio device as the input;
//    half a second after it stops, the device takes over again.
//  - The app answers the plugin now and then, so the plugin can show it's connected.
//  - One track at a time: if the plugin is on two tracks, the first one streaming wins.
//  - install() copies the plugin that ships inside the app into your plugin folders.
// (Installing is Mac and Windows only; on other systems those parts sit unused.)
#![cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code, unused_variables, unused_mut))]
use crate::audio::{epoch_ms, Out, Shared};
use ssengine::blocks::{peak, Blocker, InputChannel};
use ssengine::link;
use ssengine::RATE;
use std::net::{SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::time::{Duration, Instant};

const QUIET: Duration = Duration::from_millis(500);   // no audio this long: back to your device
const ACK_EVERY: Duration = Duration::from_millis(300);

pub fn listen(sh: Arc<Shared>) {
    std::thread::spawn(move || {
        let sock = match UdpSocket::bind(("127.0.0.1", link::PORT)) { Ok(s) => s, Err(e) => { eprintln!("plugin link unavailable: {e}"); return; } };
        sock.set_read_timeout(Some(Duration::from_millis(50))).ok();
        run(&sock, &sh);
    });
}

fn run(sock: &UdpSocket, sh: &Shared) {
    let mut buf = vec![0u8; 16 + link::MAX_FRAMES * 2 * 4 + 64];
    let (mut last_rx, mut last_ack) = (Instant::now() - QUIET * 2, Instant::now());
    let mut peer: Option<SocketAddr> = None;
    let mut blocker: Option<(InputChannel, Blocker)> = None;
    let mut frames_in: u64 = 0;
    // A steady clock for the stream: when frame 0 would have arrived if nothing
    // were ever late (the least-delayed arrival so far), creeping later by
    // 0.05 ms a packet so it follows any drift between the DAW's clock and this one.
    let (mut t0, mut last_at) = (f64::NAN, f64::MIN);
    loop {
        if let Ok((n, from)) = sock.recv_from(&mut buf) {
            // one track at a time: while one plugin is live, another copy of it is ignored
            let other = sh.plugin_live.load(Relaxed) && peer.map_or(false, |q| q != from);
            if let Some(p) = link::decode(&buf[..n]).filter(|_| !other) {
                peer = Some(from); last_rx = Instant::now();
                if !sh.plugin_live.swap(true, Relaxed) { blocker = None; }   // just connected
                sh.set_in_lat(p.latency_ms);
                // your channel choice: both sides as stereo, otherwise one mono mix of the track
                let want = if sh.channel() == InputChannel::Stereo && p.planes.len() > 1 { InputChannel::Stereo } else { InputChannel::Mix };
                if blocker.as_ref().map_or(true, |(c, _)| *c != want) { blocker = Some((want, Blocker::new(want))); frames_in = 0; t0 = f64::NAN; last_at = f64::MIN; }
                let (_, b) = blocker.as_mut().unwrap();
                let gain = sh.mic_gain();
                sh.note_peak(p.planes.iter().map(|pl| peak(pl)).fold(0.0, f32::max) * gain);
                let ms = |frames: u64| frames as f64 * 1000.0 / RATE as f64;
                frames_in += p.planes[0].len() as u64;
                let base = epoch_ms() - ms(frames_in);
                t0 = if t0.is_nan() { base } else { base.min(t0 + 0.05) };
                let rec = sh.rec.load(Relaxed);
                b.feed(&link::interleave(&p.planes), p.planes.len(), gain, |blk| {
                    // when this block was ready (its last frame arrived), on the steady clock
                    let at = (t0 + ms(blk.first_frame + ssengine::FRAMES as u64)).max(last_at);
                    last_at = at;
                    if rec { let _ = sh.out_tx.send(Out::RecMic { at_ms: at - p.latency_ms as f64, data: blk.planes[0].clone() }); }
                    if sh.direct_active.load(Relaxed) { let _ = sh.direct_tx.try_send((blk.planes.clone(), at)); }   // the direct app-to-app path too
                    let _ = sh.out_tx.send(Out::Block { at_ms: at, planes: blk.planes });
                });
            }
        }
        if sh.plugin_live.load(Relaxed) && last_rx.elapsed() > QUIET { sh.plugin_live.store(false, Relaxed); blocker = None; }
        if let Some(to) = peer { if last_ack.elapsed() >= ACK_EVERY && last_rx.elapsed() < Duration::from_secs(5) { let _ = sock.send_to(&link::ACK, to); last_ack = Instant::now(); } }
    }
}

// ---- installing the plugin into your DAW's plugin folders ----

const VST3: &str = "air.band Send.vst3";
#[cfg(target_os = "macos")]
const AU: &str = "air.band Send.component";

/// Where the plugin ships inside the app (the bundle's resources).
fn shipped() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    [dir.join("plugin"), dir.join("../Resources/plugin")].into_iter().find(|p| p.join(VST3).exists())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.exists() { std::fs::remove_dir_all(to)?; }
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?; let dest = to.join(e.file_name());
        if e.file_type()?.is_dir() { copy_dir(&e.path(), &dest)?; } else { std::fs::copy(e.path(), dest)?; }
    }
    Ok(())
}

/// Copy the plugin into your plugin folders. Returns where each format went.
pub fn install() -> Result<Vec<String>, String> {
    let src = shipped().ok_or("This version of the app doesn’t include the plugin. Download the latest app.")?;
    let mut done = vec![];
    #[cfg(target_os = "macos")]
    {
        let home = PathBuf::from(std::env::var("HOME").map_err(|e| e.to_string())?);
        for (name, folder) in [(VST3, "Library/Audio/Plug-Ins/VST3"), (AU, "Library/Audio/Plug-Ins/Components")] {
            let to = home.join(folder).join(name);
            copy_dir(&src.join(name), &to).map_err(|e| format!("Couldn’t copy {name}: {e}"))?;
            // a downloaded app's files carry macOS's quarantine flag; DAWs won't load a flagged plugin
            let _ = std::process::Command::new("xattr").args(["-dr", "com.apple.quarantine"]).arg(&to).status();
            done.push(to.display().to_string());
        }
        // ask macOS to notice the new Audio Unit without a restart
        let _ = std::process::Command::new("killall").arg("-9").arg("AudioComponentRegistrar").status();
    }
    #[cfg(target_os = "windows")]
    {
        // the standard folder (needs admin rights), else the per-user VST3 folder
        let common = std::env::var("COMMONPROGRAMFILES").map(|c| PathBuf::from(c).join("VST3")).ok();
        let user = std::env::var("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Programs/Common/VST3")).map_err(|e| e.to_string())?;
        let placed = common.as_ref().and_then(|c| copy_dir(&src.join(VST3), &c.join(VST3)).ok().map(|_| c.join(VST3)));
        let to = match placed { Some(p) => p, None => { copy_dir(&src.join(VST3), &user.join(VST3)).map_err(|e| format!("Couldn’t copy the plugin: {e}"))?; user.join(VST3) } };
        done.push(to.display().to_string());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { let _ = &src; return Err("The plugin is for Mac and Windows.".into()); }
    #[allow(unreachable_code)]
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::Shared;
    use ssengine::link::{encode, Packet};

    // The plugin streams a track; the app takes it as the input, time-stamps the
    // blocks, answers the plugin, and hands back to the device when it stops.
    #[test]
    fn plugin_audio_becomes_the_input_and_the_plugin_hears_back() {
        let (tx, rx) = crossbeam_channel::unbounded();
        let sh = Shared::new(tx);
        let app = UdpSocket::bind("127.0.0.1:0").unwrap(); app.set_read_timeout(Some(Duration::from_millis(50))).unwrap();
        let addr = app.local_addr().unwrap();
        { let sh = sh.clone(); std::thread::spawn(move || run(&app, &sh)); }
        let plugin = UdpSocket::bind("127.0.0.1:0").unwrap(); plugin.set_read_timeout(Some(Duration::from_millis(500))).unwrap();
        // 1 s of a 220 Hz stereo tone in DAW-sized chunks (256 frames), roughly in real time
        let mut t = 0usize;
        for seq in 0..188u32 {
            let l: Vec<f32> = (0..256).map(|i| 0.5 * ((t + i) as f32 * 2.0 * std::f32::consts::PI * 220.0 / 48000.0).sin()).collect();
            t += 256;
            plugin.send_to(&encode(&Packet { seq, latency_ms: 6.0, planes: vec![l.clone(), l] }), addr).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(sh.plugin_live.load(Relaxed), "the plugin is the input while it streams");
        let mut ack = [0u8; 8]; let (n, _) = plugin.recv_from(&mut ack).expect("the app answers the plugin");
        assert_eq!(&ack[..n], &link::ACK);
        let blocks: Vec<_> = rx.try_iter().filter_map(|o| match o { Out::Block { at_ms, planes } => Some((at_ms, planes)), _ => None }).collect();
        assert!(blocks.len() >= 370, "about 376 blocks of 128 frames (got {})", blocks.len());
        assert!(blocks.iter().all(|(_, p)| p.len() == 1 && p[0].len() == 128), "mono mix by default, 128 frames each");
        assert!(blocks.windows(2).all(|w| w[1].0 >= w[0].0 - 0.001), "time stamps never go backwards");
        assert!((sh.in_lat() - 6.0).abs() < 0.01, "the DAW's input delay is reported to the page");
        // the plugin on a second track while the first keeps going: ignored
        let second = UdpSocket::bind("127.0.0.1:0").unwrap();
        for seq in 0..40u32 {
            plugin.send_to(&encode(&Packet { seq: 188 + seq, latency_ms: 6.0, planes: vec![vec![0.1; 256]] }), addr).unwrap();
            second.send_to(&encode(&Packet { seq, latency_ms: 9.0, planes: vec![vec![0.9; 256]] }), addr).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(Duration::from_millis(50));
        let loud = rx.try_iter().filter_map(|o| match o { Out::Block { planes, .. } => Some(planes[0][0]), _ => None }).filter(|v| *v > 0.5).count();
        assert_eq!(loud, 0, "a second track's plugin doesn't mix in while the first is live");
        // the first stops; the second keeps streaming and takes over
        for seq in 40..200u32 { second.send_to(&encode(&Packet { seq, latency_ms: 9.0, planes: vec![vec![0.9; 256]] }), addr).unwrap(); std::thread::sleep(Duration::from_millis(5)); }
        assert!((sh.in_lat() - 9.0).abs() < 0.01, "the second track takes over once the first stops");
        std::thread::sleep(QUIET + Duration::from_millis(200));
        assert!(!sh.plugin_live.load(Relaxed), "your device takes over again when the plugin stops");
    }
}
