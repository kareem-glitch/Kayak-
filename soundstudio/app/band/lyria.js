// The AI band from Google's Lyria RealTime music model. One live stream per room
// comes through our relay (relay/worker.js), which keeps the API key; every device
// plays each 2-second chunk at the same moment on the room's shared clock:
//   sample k of the stream sounds at start + k / 48000 s   (start: agreed via the room)
// The band host steers it (prompt, tempo, key, which parts the AI plays).
import { S } from '../state.js';
import { clk } from '../util.js';

let override = null; try{ override = localStorage.getItem('ss.relay'); }catch(e){}   // tests point this at a local stand-in
export const RELAY = override || 'wss://soundstudio-band.kareemo-mostafa.workers.dev';
const RATE = 48000;
export const LEAD_MS = 2000;   // start this long after the first chunk, so everyone has it in time
export const hooks = { onStatus: () => {}, onFirstChunk: () => {} };

let ws = null, roomId = null, stream = 0, chunks = [], start = null, gain = null, sources = [], nextAt = 0;
export const state = { status: 'stopped', message: '' };

const ctx = () => Tone.getContext().rawContext;
const outLat = () => { const c = ctx(); return (c.outputLatency || 0) + (c.baseLatency || 0); };

export function connect(id){
  if(ws && roomId === id && ws.readyState <= 1) return ws;
  if(ws) try{ ws.close(); }catch(e){}
  roomId = id; ws = new WebSocket(`${RELAY}/room/${encodeURIComponent(id)}`); ws.binaryType = 'arraybuffer';
  ws.onmessage = e => typeof e.data === 'string' ? onStatus(JSON.parse(e.data)) : onChunk(e.data);
  ws.onclose = () => { if(ws && ws.readyState === 3) ws = null; };
  return ws;
}
const whenOpen = () => new Promise((res, rej) => { if(ws.readyState === 1) return res(); ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('Couldn’t reach the band server')), { once: true }); });
async function send(m){ if(!ws) throw new Error('not connected'); await whenOpen(); ws.send(JSON.stringify(m)); }

function onStatus(m){
  if(m.t !== 'status') return;
  if(m.stream !== stream){ stream = m.stream; chunks = []; }
  state.status = m.state; state.message = m.message || '';
  hooks.onStatus(state);
}

function onChunk(buf){
  const dv = new DataView(buf), first = dv.getFloat64(0, true), id = dv.getUint32(8, true);
  if(id !== stream){ stream = id; chunks = []; }
  const pcm = new Int16Array(buf.slice(12)), n = pcm.length / 2;
  const c = { first, n, pcm };
  if(first === 0) hooks.onFirstChunk(clk());
  chunks.push(c); if(chunks.length > 8) chunks.shift();   // keep the last ~16 s
  if(start !== null) schedule(c);
}

// Play chunk c at its place on the shared clock. Back-to-back chunks are joined
// sample-exactly; if the clock mapping drifts more than 15 ms, resync.
function schedule(c){
  const cx = ctx(); if(!gain){ gain = cx.createGain(); Tone.connect(gain, Tone.getDestination()); setVolume(volumeDb); }
  const at = start + c.first / RATE * 1000;                                // wall-clock ms (this device's clock)
  let when = cx.currentTime + (at - clk()) / 1000 - outLat();             // audio-context time
  if(nextAt && Math.abs(when - nextAt) < 0.015) when = nextAt;
  let offset = 0;
  if(when < cx.currentTime + 0.01){ offset = cx.currentTime + 0.01 - when; when = cx.currentTime + 0.01; }   // late: skip what already passed
  if(offset >= c.n / RATE) return;
  const b = cx.createBuffer(2, c.n, RATE), L = b.getChannelData(0), R = b.getChannelData(1);
  for(let i = 0; i < c.n; i++){ L[i] = c.pcm[2 * i] / 32768; R[i] = c.pcm[2 * i + 1] / 32768; }
  const src = cx.createBufferSource(); src.buffer = b; src.connect(gain); src.start(when, offset);
  sources.push(src); src.onended = () => { sources = sources.filter(s => s !== src); };
  nextAt = when - offset + c.n / RATE;
}

// Start playback: sample 0 of the current stream sounds at wall-clock `atLocal` (ms).
export function playAt(atLocal){
  stopLocal(); start = atLocal; nextAt = 0;
  chunks.forEach(schedule);
}
export function stopLocal(){ start = null; nextAt = 0; sources.forEach(s => { try{ s.stop(); }catch(e){} }); sources = []; }
export const playing = () => start !== null;
let volumeDb = 0;
export function setVolume(db){ volumeDb = db; if(gain) gain.gain.value = db === -Infinity ? 0 : Math.pow(10, db / 20); }

// ---- band host: steering ----
// Lyria's key setting names a major key and its relative minor.
const SCALES = ['C_MAJOR_A_MINOR', 'D_FLAT_MAJOR_B_FLAT_MINOR', 'D_MAJOR_B_MINOR', 'E_FLAT_MAJOR_C_MINOR', 'E_MAJOR_D_FLAT_MINOR', 'F_MAJOR_D_MINOR', 'G_FLAT_MAJOR_E_FLAT_MINOR', 'G_MAJOR_E_MINOR', 'A_FLAT_MAJOR_F_MINOR', 'A_MAJOR_G_FLAT_MINOR', 'B_FLAT_MAJOR_G_MINOR', 'B_MAJOR_A_FLAT_MINOR'];
const PC = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };
export function scaleFor(key){
  const m = String(key || '').match(/^\s*([A-G][#b]?)\s*(m(?:in(?:or)?)?\b)?/i); if(!m) return 'SCALE_UNSPECIFIED';
  const root = PC[m[1][0].toUpperCase() + (m[1][1] || '')]; if(root === undefined) return 'SCALE_UNSPECIFIED';
  const minor = !!m[2] || /minor/i.test(key);
  return SCALES[(root + (minor ? 3 : 0)) % 12];
}
const PART_WORDS = { drums: 'drums', bass: 'bass guitar', keys: 'keyboards (electric piano, organ)', guitar: 'electric guitar' };
// What the band should play: the jam's description plus the parts nobody has taken.
export function settings(){
  const a = S.arr, human = id => (S.seats.find(s => s.id === id) || {}).human;
  const parts = Object.keys(PART_WORDS).filter(id => !human(id) && !(id === 'guitar' && a.guitar === 'off') && !(id === 'keys' && a.keys === 'off'));
  const text = `${a.prompt || a.title}. Instrumental ${a.style} backing band` + (parts.length ? ': ' + parts.map(p => PART_WORDS[p]).join(', ') : '') + '. No vocals.';
  return {
    prompts: [{ text, weight: 1 }],
    config: { bpm: a.bpm, scale: scaleFor(a.key), muteDrums: !!human('drums'), muteBass: !!human('bass') },
  };
}
export const play = () => send(Object.assign({ t: 'play' }, settings()));
export const update = () => send(Object.assign({ t: 'update' }, settings())).catch(() => {});
export const stop = () => send({ t: 'stop' }).catch(() => {});
