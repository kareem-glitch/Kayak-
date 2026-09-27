// Desktop app version of web-io.js (same exports). Audio in and out is
// native (see src-tauri); this module talks to it over the app's private local
// WebSocket; io.js picks this module when the page runs inside the app, so the
// rest of the page is the same code as the website.
export const NATIVE = true;
export const RATE = 48000, FRAMES = 128, BLOCK_MS = FRAMES / RATE * 1000;
export const micOptions = () => ({});
export const isPhone = () => false;
export const stats = { under: 0, players: {}, inPeak: 0 };

let ws = null, onBlock = () => {}, q = 0, inLat = 0, outLat = 0, inputName = '', inChannels = 1, channel = '1', micOn = true;
let recording = false, recStartedAt = 0, recDone = null;
const replies = new Map();
const store = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
// native times are wall-clock (epoch) ms; the page's shared clock is performance-based
const toClk = epochMs => epochMs + (performance.timeOrigin + performance.now() - Date.now());

function request(msg){
  return new Promise((res, rej) => {
    if(!ws || ws.readyState !== 1) return rej(new Error('Audio engine not connected'));
    const id = ++q; replies.set(id, { res, rej }); ws.send(JSON.stringify(Object.assign({ q: id }, msg)));
  }).then(r => { if(!r.ok) throw new Error(r.error || 'Audio engine error'); if(r.input !== undefined){ inputName = r.input; inChannels = r.inChannels; } return r; });
}
const tell = msg => { if(ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function onMessage(e){
  if(typeof e.data === 'string'){
    const m = JSON.parse(e.data);
    if(m.t === 'stats'){ stats.under = m.under; stats.players = m.players; stats.inPeak = m.peak; inLat = m.inLat; outLat = m.outLat; }
    else if(m.q && replies.has(m.q)){ replies.get(m.q).res(m); replies.delete(m.q); }
    return;
  }
  const buf = e.data, dv = new DataView(buf), tag = dv.getUint8(0);
  if(tag === 1){
    const n = dv.getUint8(1), at = dv.getFloat64(8, true), planes = [];
    for(let c = 0; c < n; c++) planes.push(new Float32Array(buf, 16 + c * FRAMES * 4, FRAMES));
    onBlock(planes, toClk(at));
  } else if(tag === 2 && recDone){
    const n = dv.getUint32(4, true), heard = dv.getFloat64(8, true);
    // native gives the mic on the heard timeline; recording.js expects it captured
    // (input + output delay) later, as in the browser, and shifts it back itself
    const acoustic = new Float32Array(buf, 16, n), out = new Float32Array(buf, 16 + n * 4, n);
    const shift = Math.round((inputLatencyMs() + outputLatencyMs()) / 1000 * RATE), mic = new Float32Array(n);
    for(let j = shift; j < n; j++) mic[j] = acoustic[j - shift];
    const done = recDone; recDone = null; done({ mic, out: new Float32Array(out), sampleRate: RATE, heardAt: toClk(heard) });
  }
}

export const context = () => null;
export async function start(stream, blockHandler){
  onBlock = blockHandler;
  const { port, token } = window.__SS_NATIVE;
  await new Promise((res, rej) => {
    ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${token}`); ws.binaryType = 'arraybuffer';
    ws.onopen = res; ws.onerror = () => rej(new Error('Couldn’t reach the audio engine')); ws.onmessage = onMessage;
  });
  await request({ t: 'start', input: store('ss.inDev') || '', output: store('ss.outDev') || '', channel });
}
export function deliver(id, planes){
  if(!ws || ws.readyState !== 1) return;
  const idb = new TextEncoder().encode(id), n = planes[0].length, b = new Uint8Array(3 + idb.length + planes.length * n * 4);
  b[0] = 3; b[1] = idb.length; b[2] = planes.length; b.set(idb, 3);
  const dv = new DataView(b.buffer); let o = 3 + idb.length;
  for(const p of planes) for(let i = 0; i < n; i++, o += 4) dv.setFloat32(o, p[i], true);
  ws.send(b);
}
export const forget = id => tell({ t: 'gone', id });
export const setFeel = name => tell({ t: 'feel', name });
export const setBufferLimit = blocks => tell({ t: 'limit', samples: blocks * FRAMES });
export const connectMic = () => inChannels;
export function setInputChannel(ch){ channel = ch; if(ws) request({ t: 'channel', ch }).catch(() => {}); return inChannels; }
export async function useInput(deviceId){ await request({ t: 'input', id: deviceId || '' }); return inChannels; }
export const currentInputId = () => inputName;
export function setMicEnabled(on){ micOn = on; tell({ t: 'mic', on }); }
export const micEnabled = () => micOn;
export const canChooseOutput = () => true;
export const useOutput = deviceId => request({ t: 'output', id: deviceId || '' });
export async function listDevices(){
  const r = await request({ t: 'devices' });
  return { inputs: [{ id: '', label: 'System default' }, ...r.inputs], outputs: [{ id: '', label: 'System default' }, ...r.outputs] };
}
export const inputLatencyMs = () => Math.round(inLat);
export const outputLatencyMs = () => Math.round(outLat);
export const inputSampleRate = () => RATE;
export const echoCancelling = () => false;
export function startRecording(){ if(!ws) throw new Error('audio not started'); recording = true; recStartedAt = performance.now(); tell({ t: 'rec', on: true }); }
export function stopRecording(){ return new Promise(res => { recDone = res; recording = false; tell({ t: 'rec', on: false }); }); }
export const recordedSeconds = () => recording ? (performance.now() - recStartedAt) / 1000 : 0;
