// The stems band: a backing track split into parts (drums, bass, keys, guitar,
// extras) that every device plays in step on the room's shared clock. Taking a
// seat silences that part cleanly, because it is its own recording.
//   stock tracks: /packs/<id>/pack.json + one mp3 per part, served with the site
//   prompted tracks: made by /api/stems on the band host's device, then shared
//                    with the room over the players' own connections
// Position p of the loop sounds at start + p on every device (start is agreed via
// the room, like the other bands), so a late joiner comes in at the right place.
import { S } from '../state.js';
import { clk } from '../util.js';

// which seat each part belongs to ('other' = extras nobody can take over)
export const SEAT_OF = { drums: 'drums', bass: 'bass', piano: 'keys', guitar: 'guitar', other: null };
export const hooks = { onReady: () => {} };
// Whether a seat's human is playing right now (so its AI part should be silent).
// Free jam: whenever the seat is taken. BARS sets this to "only on their turn".
export const seatRule = { playing: s => s.human };
let featured = null;   // BARS: the AI band's turn puts this part up front
export function feature(name){ featured = name; applySeats(); }

let current = null;          // { id, bpm, buffers: {name: AudioBuffer}, data: {name: base64} (prompted only) }
let loading = null, gains = {}, master = null, sources = [], start = null, volumeDb = 0;
const ctx = () => Tone.getContext().rawContext;
const outLat = () => { const c = ctx(); return (c.outputLatency || 0) + (c.baseLatency || 0); };
const b64ToBuf = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;

export const ready = id => !!(current && current.id === id);
export const parts = () => current ? Object.keys(current.buffers) : [];
export const payload = () => current && current.data;   // what the host shares with the room

async function decodeAll(id, bpm, files, data){
  const buffers = {};
  for(const [name, buf] of Object.entries(files)) buffers[name] = await ctx().decodeAudioData(buf);
  // drop parts that came out (almost) silent, e.g. no guitar in this track
  const energy = b => { let e = 0; for(let c = 0; c < b.numberOfChannels; c++){ const d = b.getChannelData(c); for(let i = 0; i < d.length; i += 16) e += d[i] * d[i]; } return e; };
  const total = Object.values(buffers).reduce((a, b) => a + energy(b), 0) || 1;
  for(const name of Object.keys(buffers)) if(energy(buffers[name]) / total < 0.003) delete buffers[name];
  const wasPlaying = start;
  stopSources(); current = { id, bpm, buffers, data }; gains = {};
  if(wasPlaying !== null) schedule();
  applySeats(); hooks.onReady(id);
}

// A stock track from the site.
export async function loadStock(id){
  if(ready(id)) return;
  if(loading === id) return; loading = id;
  try{
    const meta = await (await fetch(`/packs/${id}/pack.json`)).json(), files = {};
    await Promise.all(Object.keys(meta.stems).map(async name => { files[name] = await (await fetch(`/packs/${id}/${name}.mp3`)).arrayBuffer(); }));
    if(loading === id) await decodeAll(id, meta.bpm, files, null);
  } finally { if(loading === id) loading = null; }
}
// A prompted track: the parts as base64 mp3s (from the server, or from the host).
export async function loadData(id, bpm, data){
  if(ready(id)) return;
  const files = {}; for(const [name, s] of Object.entries(data)) files[name] = b64ToBuf(s);
  await decodeAll(id, bpm, files, data);
}

// Loop length: the longest whole number of bars that fits in the recording.
function loopLength(){
  const shortest = Math.min(...Object.values(current.buffers).map(b => b.duration)), bar = 240 / (current.bpm || 120);
  const bars = Math.floor(shortest / bar + 0.02);
  return bars >= 2 ? Math.min(bars * bar, shortest) : shortest;
}
function schedule(){
  if(!current || start === null || !Object.keys(current.buffers).length) return;
  const cx = ctx();
  if(!master){ master = cx.createGain(); Tone.connect(master, Tone.getDestination()); setVolume(volumeDb); }
  const L = loopLength();
  let t0 = cx.currentTime + 0.1;
  let pos = (clk() + (0.1 + outLat()) * 1000 - start) / 1000;   // where in the loop that moment is, for the room
  if(pos < 0){ t0 -= pos; pos = 0; }
  const offset = pos % L;
  for(const [name, buf] of Object.entries(current.buffers)){
    if(!gains[name]){ gains[name] = cx.createGain(); gains[name].connect(master); }
    const src = cx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = L;
    src.connect(gains[name]); src.start(t0, offset); sources.push(src);
  }
  applySeats();
}
// Re-align on the fly: the loop keeps its old timing until the song reaches
// boundaryPos (ms), then continues from there on the new timing (start = newStart).
// Moving later leaves a short breath; moving earlier skips the difference.
export function shiftAt(boundaryPos, newStart){
  if(!current || start === null){ start = newStart; return; }
  const cx = ctx(), L = loopLength(), toAudio = wall => cx.currentTime + (wall - clk()) / 1000 - outLat();
  const tOld = Math.max(cx.currentTime + 0.02, toAudio(start + boundaryPos)), tNew = Math.max(tOld, toAudio(newStart + boundaryPos));
  const pos = (clk() + (tNew - cx.currentTime + outLat()) * 1000 - newStart) / 1000;   // where the new timing is at tNew
  sources.forEach(s => { try{ s.stop(tOld); }catch(e){} });
  const old = sources; sources = [];
  for(const [name, buf] of Object.entries(current.buffers)){
    const src = cx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = L;
    src.connect(gains[name]); src.start(tNew, ((pos % L) + L) % L); sources.push(src);
  }
  setTimeout(() => old.forEach(s => { try{ s.disconnect(); }catch(e){} }), Math.max(0, (tOld - cx.currentTime) * 1000 + 200));
  start = newStart;
}
function stopSources(){ sources.forEach(s => { try{ s.stop(); }catch(e){} }); sources = []; }

// Start: position 0 of the loop sounds at wall-clock atLocal (ms) on this device.
export function playAt(atLocal){ stopSources(); start = atLocal; schedule(); }
export function stop(){ stopSources(); start = null; }
export const playing = () => start !== null && sources.length > 0;

// Seats and the host's part levels: a taken seat silences its part for everyone.
export function applySeats(){
  const cx = ctx();
  for(const [name, g] of Object.entries(gains)){
    const seat = SEAT_OF[name], s = seat && S.seats.find(x => x.id === seat);
    const db = seat ? ((S.levels || {})[seat] || 0) : 0;
    let v = s && seatRule.playing(s) ? 0 : db <= -30 ? 0 : Math.pow(10, db / 20);
    if(featured) v *= name === featured ? 1.8 : 0.75;
    g.gain.setTargetAtTime(v, cx.currentTime, 0.015);
  }
}
export const gainOf = name => gains[name] ? gains[name].gain.value : null;   // for tests
export function setVolume(db){ volumeDb = db; if(master) master.gain.value = db === -Infinity ? 0 : Math.pow(10, db / 20); }
