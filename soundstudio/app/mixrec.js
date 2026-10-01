// Records the jam as you experienced it, as a compressed audio or video file:
// your instrument, the other players as they reached you, and the band; with
// video, the players' camera tiles drawn onto a 1280x720 canvas.
// Works the same in the browser and the desktop app: players' audio comes from
// the room's packet taps (mixed by the same jitter-buffer worklet the browser
// plays with, in a silent recording-only AudioContext), the band from Tone.js.
import * as room from './net/room.js';
import { $ } from './util.js';

let rec = null;
const pick = types => types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
const VIDEO = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
const AUDIO = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
export const supported = () => !!window.MediaRecorder;

export async function start({ video }){
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.audioWorklet.addModule(new URL('./audio/worklet.js', import.meta.url));
  const mix = new AudioWorkletNode(ctx, 'jam-io', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination(); mix.connect(dest);
  mix.port.postMessage({ limit: 16 * 128 });
  mix.port.onmessage = () => {};
  room.taps.local = planes => mix.port.postMessage({ id: 'me', planes: planes.map(p => p.slice(0)) });
  room.taps.remote = (id, planes) => mix.port.postMessage({ id, planes });
  // the band, from Tone.js's own context
  let bandDest = null;
  try{ bandDest = Tone.getContext().rawContext.createMediaStreamDestination(); Tone.connect(Tone.getDestination(), bandDest); ctx.createMediaStreamSource(bandDest.stream).connect(dest); }catch(e){ console.warn('band not recorded', e); }
  const tracks = [...dest.stream.getAudioTracks()];
  let canvas = null, draw = null;
  if(video){
    canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const g = canvas.getContext('2d');
    draw = () => { paint(g, canvas); rec && rec.video && (rec.raf = requestAnimationFrame(draw)); };
    tracks.unshift(...canvas.captureStream(30).getVideoTracks());
  }
  const mimeType = pick(video ? VIDEO : AUDIO);
  const mr = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType, audioBitsPerSecond: 192000, videoBitsPerSecond: 4000000 } : {});
  const parts = []; mr.ondataavailable = e => e.data.size && parts.push(e.data);
  rec = { ctx, mix, mr, parts, video, bandDest, raf: 0 };
  mr.start(1000); if(draw) draw();
}

export function stop(){
  if(!rec) return Promise.resolve(null);
  const r = rec; rec = null; cancelAnimationFrame(r.raf);
  room.taps.local = room.taps.remote = null;
  return new Promise(res => {
    r.mr.onstop = () => {
      try{ Tone.getDestination().disconnect(r.bandDest); }catch(e){}
      r.ctx.close();
      const type = r.mr.mimeType || (r.video ? 'video/webm' : 'audio/webm');
      const blob = new Blob(r.parts, { type });
      const ext = /mp4/.test(type) ? (r.video ? 'mp4' : 'm4a') : 'webm';
      res({ url: URL.createObjectURL(blob), type, ext, video: r.video });
    };
    r.mr.stop();
  });
}

// One frame: every player's tile (camera or initial) in a grid, with names.
function paint(g, c){
  g.fillStyle = '#121c1f'; g.fillRect(0, 0, c.width, c.height);
  const tiles = [...document.querySelectorAll('#players .tile')];
  const n = Math.max(1, tiles.length), cols = n > 1 ? 2 : 1, rows = Math.ceil(n / cols), gap = 12;
  const w = (c.width - gap * (cols + 1)) / cols, h = (c.height - gap * (rows + 1)) / rows;
  tiles.forEach((t, i) => {
    const x = gap + (i % cols) * (w + gap), y = gap + Math.floor(i / cols) * (h + gap);
    g.save(); g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 16) : g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#1f2f34'; g.fillRect(x, y, w, h);
    const v = !t.classList.contains('nocam') && t.querySelector('video');
    if(v && v.videoWidth){   // cover-fit, mirrored for yourself like on screen
      const s = Math.max(w / v.videoWidth, h / v.videoHeight), vw = v.videoWidth * s, vh = v.videoHeight * s;
      if(t.classList.contains('me')){ g.translate(x + w, y); g.scale(-1, 1); g.drawImage(v, (w - vw) / 2, (h - vh) / 2, vw, vh); g.setTransform(1, 0, 0, 1, 0, 0); }
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
