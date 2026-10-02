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
let statsSeen = 0, blocksIn = 0;
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
    if(m.t === 'direct'){ direct.onState(m.id, m.send, m.recv); return; }
    if(m.t === 'stats'){ statsSeen++; stats.under = m.under; stats.players = m.players; stats.inPeak = m.peak; stats.plugin = !!m.plugin; stats.update = m.update || null; inLat = m.inLat; outLat = m.outLat; }
    else if(m.q && replies.has(m.q)){ replies.get(m.q).res(m); replies.delete(m.q); }
    return;
  }
  const buf = e.data, dv = new DataView(buf), tag = dv.getUint8(0);
  if(tag === 1){
    blocksIn++;
    const n = dv.getUint8(1), at = dv.getFloat64(8, true), planes = [];
    for(let c = 0; c < n; c++) planes.push(new Float32Array(buf, 16 + c * FRAMES * 4, FRAMES));
    onBlock(planes, toClk(at));
  } else if(tag === 4){   // another app's audio, straight from it (direct path)
    const idn = dv.getUint8(1), n = dv.getUint8(2), bits = dv.getUint8(3), seq = dv.getUint32(4, true), timeMs = dv.getFloat64(8, true), rx = dv.getFloat64(16, true);
    const id = new TextDecoder().decode(new Uint8Array(buf, 24, idn)), o = (24 + idn + 3) & ~3, frames = (buf.byteLength - o) / 4 / Math.max(1, n), planes = [];
    for(let c = 0; c < n; c++) planes.push(new Float32Array(buf, o + c * frames * 4, frames));
    direct.onBlock(id, { seq, timeMs, bits, planes, arrived: toClk(rx) });
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
// Direct audio, app to app over UDP (desktop/src-tauri/src/direct.rs), from app 0.6.0.
export const direct = { onState: () => {}, onBlock: () => {} };
export const canDirect = () => newer((window.__SS_NATIVE || {}).version || '0', '0.6.0');
export const directInfo = () => request({ t: 'directInfo' }).then(r => ({ token: r.token, addrs: r.addrs }));
export const directPeer = (id, token, addrs) => tell({ t: 'directPeer', id, token: String(token), addrs });
export const directGone = id => tell({ t: 'directGone', id });
export const setDirectPlay = on => tell({ t: 'directPlay', on });
export const setDirectGain = (id, g) => tell({ t: 'directGain', id, g });
export const setDirectBits = bits => tell({ t: 'directBits', bits });
export const setDirectEcho = on => tell({ t: 'directEcho', on });
// packets carry times on this page's clock: tell the engine how it differs from wall-clock time
const tellClock = () => tell({ t: 'clk', off: performance.timeOrigin + performance.now() - Date.now() });
// The air.band plugin (in your DAW) streams to the app; while it does, it's your input.
// Apps before 0.4.0 don't have it.
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = b.split('.').map(Number); for(let i = 0; i < 3; i++){ if((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return true; };
export const canPlugin = () => newer((window.__SS_NATIVE || {}).version || '0', '0.4.0');
export const pluginLive = () => !!stats.plugin;
export const installPlugin = () => Promise.race([request({ t: 'installPlugin' }), new Promise((_, rej) => setTimeout(() => rej(new Error('The app didn’t answer. Update to the latest app.')), 10000))]);
// Built-in tones run in the browser for now (see tone.js).
export const canTone = () => false;
export const setTone = async () => { throw new Error('Built-in tones are browser-only for now'); };
export const setToneEq = () => {};
export async function start(stream, blockHandler){
  onBlock = blockHandler;
  const { port, token } = window.__SS_NATIVE;
  await new Promise((res, rej) => {
    ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${token}`); ws.binaryType = 'arraybuffer';
    ws.onopen = res; ws.onerror = () => rej(new Error('Couldn’t reach the audio engine')); ws.onmessage = onMessage;
  });
  await request({ t: 'start', input: store('ss.inDev') || '', output: store('ss.outDev') || '', channel });
  tellClock(); setInterval(tellClock, 10000);
}
// Is the engine really working? Its output callback sets outLat (sound is going
// to the speakers) and its input sends blocks (your instrument is being heard).
// Resolves '' when both run, else what's wrong.
export function alive(ms = 3000){
  return new Promise(res => {
    const t0 = performance.now(), seen0 = statsSeen, in0 = blocksIn;
    const check = () => {
      if(!ws || ws.readyState !== 1) return res('the app’s audio engine closed');
      const out = statsSeen > seen0 && outLat > 0, inp = blocksIn > in0 + 20 || stats.plugin;
      if(out && inp) return res('');
      if(performance.now() - t0 > ms) return res(!out && !inp ? 'no sound in or out' : !out ? 'no sound out' : 'no input from your mic or interface');
      setTimeout(check, 100);
    };
    check();
  });
}
export function stop(){ if(ws){ ws.onclose = null; try{ ws.close(); }catch(e){} ws = null; } }
// Apps before 0.6.0, far-apart mode (at = wall-clock ms it should be heard): held here and handed
// to the engine just before it's due, less the engine's own output delay.
const held = []; let pump = null;
function release(){
  const due = performance.timeOrigin + performance.now() + 3 + outLat;
  while(held.length && held[0].at <= due){ const h = held.shift(); send(h.id, h.planes); }
  if(!held.length){ clearInterval(pump); pump = null; }
}
export function deliver(id, planes, at){
  if(at == null) return send(id, planes);
  if(canDirect()) return sendAt(id, planes, at);   // 0.6.0+: the engine plays it at that moment, to the sample (delay.rs)
  let i = held.length; while(i && held[i - 1].at > at) i--; held.splice(i, 0, { id, planes, at });
  if(!pump) pump = setInterval(release, 2);
}
function sendAt(id, planes, at){
  if(!ws || ws.readyState !== 1) return;
  const idb = new TextEncoder().encode(id), n = planes[0].length, o = (16 + idb.length + 3) & ~3, b = new Uint8Array(o + planes.length * n * 4);
  b[0] = 5; b[1] = idb.length; b[2] = planes.length; b.set(idb, 16);
  const dv = new DataView(b.buffer); dv.setFloat64(8, at - (performance.timeOrigin + performance.now() - Date.now()), true);   // page clock -> wall clock
  let k = o; for(const p of planes) for(let i = 0; i < n; i++, k += 4) dv.setFloat32(k, p[i], true);
  ws.send(b);
}
function send(id, planes){
  if(!ws || ws.readyState !== 1) return;
  const idb = new TextEncoder().encode(id), n = planes[0].length, b = new Uint8Array(3 + idb.length + planes.length * n * 4);
  b[0] = 3; b[1] = idb.length; b[2] = planes.length; b.set(idb, 3);
  const dv = new DataView(b.buffer); let o = 3 + idb.length;
  for(const p of planes) for(let i = 0; i < n; i++, o += 4) dv.setFloat32(o, p[i], true);
  ws.send(b);
}
export const forget = id => tell({ t: 'gone', id });
// Auto-update (app 0.6.1+): a newer version downloaded (stats.update); install it and restart now.
export const installUpdate = () => request({ t: 'update' });
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
// The pocket synth is for phones and browsers; the app plays your real instrument.
export const canSynth = () => false;
export const synthPorts = () => null;
export const measureRoundTrip = async () => null;
