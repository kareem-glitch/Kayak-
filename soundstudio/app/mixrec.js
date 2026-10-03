// Records the jam as you experienced it, as a compressed audio or video file:
// your instrument, the other players as they reached you, and the band; with
// video, the players' camera tiles drawn onto a 960x540 canvas.
// Works the same in the browser and the desktop app: players' audio comes from
// the room's packet taps (mixed by the same jitter-buffer worklet the browser
// plays with, in a silent recording-only AudioContext), the band from Tone.js.
import * as room from './net/room.js';
import { $ } from './util.js';
import * as audio from './audio/io.js';

let rec = null;
const HOLD = 120;   // ms: how far behind live the recording runs (room for blocks arriving in bursts)
const W = 960, H = 540, FPS = 24;   // the video: drawing it is the costly part (and costs the recorded sound if the page falls behind)
const clkNow = () => performance.timeOrigin + performance.now();
export const hooks = { screenEnded: () => {} };   // the screen share was stopped from the browser's bar
const pick = types => types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
const VIDEO = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];   // WebM/Opus first where it's offered (Chrome): its MP4/AAC recording clicked; Safari only does MP4
const AUDIO = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
export const supported = () => !!window.MediaRecorder;

// screen: record this browser tab (everyone's tiles, the keys you press, the turn
// bar) instead of drawing the tiles. Asked for first, while the click still counts.
export async function start({ video, screen = false }){
  if(screen && !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) throw new Error('screen recording isn’t supported here');
  if(!window.MediaRecorder) throw new Error('MediaRecorder isn’t supported here');
  const shot = screen ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' }) : null;
  // a quiet context of its own for the mix; phones that won't make another
  // (iPhone Safari limits them) share the jam's, which only adds work while recording
  let ctx = null, shared = false;
  try{ ctx = new AudioContext({ sampleRate: 48000 }); }catch(e){ console.warn('own recording context unavailable', e); }
  if(!ctx){ ctx = audio.context && audio.context(); shared = true; if(!ctx) throw new Error('no audio context for recording'); }
  const parts = [];
  rec = { ctx, shared, mix: null, dest: null, mr: null, parts, video: video || screen, bandDest: null, raf: 0, shot };
  try{
    if(ctx.state !== 'running') ctx.resume().catch(() => {});   // iPhone starts new contexts paused
    await ctx.audioWorklet.addModule(new URL('./audio/worklet.js', import.meta.url));
    const mix = rec.mix = new AudioWorkletNode(ctx, 'jam-io', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const dest = rec.dest = ctx.createMediaStreamDestination(); mix.connect(dest);
    mix.port.onmessage = () => {};
    // Every block is placed at the moment it was heard (or played), HOLD later, not
    // jitter-buffered as it arrives: the blocks come in bursts, and a live-sized buffer
    // ran dry between them (a click each time: the grain). The band and the video are
    // held back by the same HOLD, so it all stays in sync.
    let base = null;   // ms on the page's clock when this context's frame 0 played
    const frameOf = ms => { const b = clkNow() - ctx.currentTime * 1000; base = base == null ? b : base + (b - base) * 0.01; return Math.round((ms - base) / 1000 * ctx.sampleRate); };
    // each player's stream back to back (timestamps wobble; see tracks.js), moved only after a real gap
    const next = new Map();
    room.taps.mix = (id, planes, at) => {
      const e = next.get(id); if(e != null && Math.abs(at - e) < 100) at = e;
      next.set(id, at + planes[0].length / 48);
      mix.port.postMessage({ id, planes: planes.map(p => p.slice(0)), at: frameOf(at + HOLD) });
    };
    // the band, from Tone.js's own context (live, so delayed by HOLD less its own output delay)
    try{
      rec.bandDest = Tone.getContext().rawContext.createMediaStreamDestination(); Tone.connect(Tone.getDestination(), rec.bandDest);
      const raw = Tone.getContext().rawContext, hold = ctx.createDelay(1); hold.delayTime.value = Math.max(0, HOLD - ((raw.outputLatency || 0) + (raw.baseLatency || 0)) * 1000) / 1000;
      ctx.createMediaStreamSource(rec.bandDest.stream).connect(hold).connect(dest);
    }catch(e){ console.warn('band not recorded', e); }
    const tracks = [...dest.stream.getAudioTracks()];
    let draw = null;
    if(shot || video){
      // the picture, HOLD behind live like the sound: each frame is drawn into a small ring
      // and the one from HOLD ago goes out (the screen share too, via a hidden video element)
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      if(!canvas.captureStream) throw new Error('this browser can’t record video from the page');
      const g = canvas.getContext('2d'), LAG = Math.round(HOLD / (1000 / FPS)), ring = [];
      for(let i = 0; i <= LAG; i++){ const c = document.createElement('canvas'); c.width = W; c.height = H; ring.push(c); }
      let shown = null;
      if(shot){
        shown = document.createElement('video'); shown.muted = true; shown.playsInline = true; shown.srcObject = shot; shown.play().catch(() => {});
        shot.getVideoTracks()[0].onended = () => { if(rec && rec.shot === shot) hooks.screenEnded(); };
      }
      const frame = c => { const cg = c.getContext('2d'); if(shown){ cg.fillStyle = '#0f1011'; cg.fillRect(0, 0, c.width, c.height); if(shown.videoWidth){ const sc = Math.min(c.width / shown.videoWidth, c.height / shown.videoHeight), w = shown.videoWidth * sc, h = shown.videoHeight * sc; cg.drawImage(shown, (c.width - w) / 2, (c.height - h) / 2, w, h); } } else paint(cg, c); };
      // 30 frames a second (not every screen refresh: 120 Hz screens would paint 4x as often for nothing)
      let last = 0, n = 0;
      draw = t => {
        if(!t || t - last >= 1000 / FPS - 2){ last = t || 0; frame(ring[n % ring.length]); n++; const out = ring[Math.max(0, n - 1 - LAG) % ring.length]; g.drawImage(out, 0, 0); }
        rec && rec.video && (rec.raf = requestAnimationFrame(draw));
      };
      draw();   // a first frame before recording starts (Safari wants one)
      tracks.unshift(...canvas.captureStream(FPS).getVideoTracks());
    }
    // the best format this browser records (Safari: MP4); if it refuses, let it pick
    const stream = new MediaStream(tracks), mimeType = pick(video || screen ? VIDEO : AUDIO);
    let mr = null, err = null;
    for(const opts of [mimeType ? { mimeType, audioBitsPerSecond: 192000, videoBitsPerSecond: 2500000 } : null, mimeType ? { mimeType } : null, {}]){
      if(!opts) continue;
      try{ mr = new MediaRecorder(stream, opts); mr.ondataavailable = e => e.data.size && parts.push(e.data); mr.start(1000); break; }catch(e){ err = e; mr = null; }
    }
    if(!mr) throw err || new Error('MediaRecorder couldn’t start');
    rec.mr = mr;
  }catch(e){ cleanup(rec); rec = null; throw e; }
}
function cleanup(r){
  cancelAnimationFrame(r.raf);
  room.taps.local = room.taps.remote = room.taps.mix = null;
  try{ if(r.bandDest) Tone.getDestination().disconnect(r.bandDest); }catch(e){}
  if(r.shot) r.shot.getTracks().forEach(t => t.stop());   // end the screen share
  if(r.shared){ try{ r.mix && r.mix.disconnect(); }catch(e){} r.mix && r.mix.port.postMessage({ gone: 'me' }); }
  else r.ctx.close().catch(() => {});
}

export function stop(){
  if(!rec) return Promise.resolve(null);
  const r = rec; rec = null;
  return new Promise(res => {
    r.mr.onstop = () => {
      cleanup(r);
      const type = r.mr.mimeType || (r.parts[0] && r.parts[0].type) || (r.video ? 'video/webm' : 'audio/webm');
      const blob = new Blob(r.parts, { type });
      const ext = /mp4/.test(type) ? (r.video ? 'mp4' : 'm4a') : 'webm';
      res({ url: URL.createObjectURL(blob), type, ext, video: r.video });
    };
    r.mr.stop();
  });
}

// One frame: every player's tile (camera or initial) in a grid, with names.
function paint(g, canvas){
  // laid out on a 1280x720 page, scaled to the canvas
  const k = canvas.width / 1280, c = { width: 1280, height: 720 }; g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = '#121c1f'; g.fillRect(0, 0, c.width, c.height);
  // your on-screen synth, if it's open: a strip of its keys along the bottom, lit as you play
  const keys = [...document.querySelectorAll('#synthPanel:not([hidden]) .key')], strip = keys.length ? 130 : 0;
  if(strip){
    const kg = 6, kw = Math.min(110, (c.width - kg * (keys.length + 1)) / keys.length), x0 = (c.width - (kw + kg) * keys.length + kg) / 2, y = c.height - strip + 12, kh = strip - 24;
    keys.forEach((k, i) => {
      const x = x0 + i * (kw + kg), on = k.classList.contains('on');
      g.fillStyle = on ? '#ffcc00' : k.classList.contains('root') ? '#3a3b40' : '#26272b'; g.beginPath(); g.roundRect ? g.roundRect(x, y, kw, kh, 10) : g.rect(x, y, kw, kh); g.fill();
      g.fillStyle = on ? '#0f1011' : '#ececea'; g.font = '700 22px "Barlow", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText((k.querySelector('.nm') || {}).textContent || '', x + kw / 2, y + kh / 2);
    });
  }
  const tiles = [...document.querySelectorAll('#players .tile')];
  const n = Math.max(1, tiles.length), cols = n > 1 ? 2 : 1, rows = Math.ceil(n / cols), gap = 12;
  const w = (c.width - gap * (cols + 1)) / cols, h = (c.height - strip - gap * (rows + 1)) / rows;
  tiles.forEach((t, i) => {
    const x = gap + (i % cols) * (w + gap), y = gap + Math.floor(i / cols) * (h + gap);
    g.save(); g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 16) : g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#1f2f34'; g.fillRect(x, y, w, h);
    const v = !t.classList.contains('nocam') && t.querySelector('video');
    if(v && v.videoWidth){   // cover-fit, mirrored for yourself like on screen
      const s = Math.max(w / v.videoWidth, h / v.videoHeight), vw = v.videoWidth * s, vh = v.videoHeight * s;
      if(t.classList.contains('me')){ g.translate(x + w, y); g.scale(-1, 1); g.drawImage(v, (w - vw) / 2, (h - vh) / 2, vw, vh); g.setTransform(k, 0, 0, k, 0, 0); }
      else g.drawImage(v, x + (w - vw) / 2, y + (h - vh) / 2, vw, vh);
    } else {
      g.fillStyle = '#9aaba7'; g.font = '800 64px "Geist", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText((t.querySelector('.initial') || {}).textContent || '', x + w / 2, y + h / 2);
    }
    g.restore();
    const name = (t.querySelector('.tname') || {}).textContent || '';
    g.font = '600 22px "Geist", system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    const tw = g.measureText(name).width + 28;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect ? g.roundRect(x + 14, y + h - 50, tw, 36, 18) : g.rect(x + 14, y + h - 50, tw, 36); g.fill();
    g.fillStyle = '#fff'; g.fillText(name, x + 28, y + h - 32);
  });
  g.font = '800 20px "Geist", system-ui, sans-serif'; g.fillStyle = 'rgba(240,162,56,.9)'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillText('air.band', c.width - 20, c.height - 16);
}
export const drawFrame = canvas => paint(canvas.getContext('2d'), canvas);   // tests
