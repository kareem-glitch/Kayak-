// A room of up to 4 people, everyone connected directly to everyone (WebRTC).
// The invite link names the room's creator ("owner"), who introduces newcomers
// to the others. Per person: one reliable control connection (JSON messages)
// and one raw audio channel (unordered, never retransmitted) carrying the hub
// packet format. A public PeerJS broker only makes the introductions.
// Band logic lives in session.js; this module reports events via `events`.
import { encodePacket, decodePacket, packetBytes, seqDelta } from '../../audio/hub-protocol.js';
import { clk } from '../util.js';
import { me, PROTOCOL_VERSION } from '../state.js';
import { RATE, FRAMES } from '../audio/io.js';
import * as audio from '../audio/io.js';

export const MAX_ROOM = 4;
// STUN finds a direct path; the TURN relay (free public Open Relay, best effort)
// carries the call when routers or mobile networks block direct connections.
const ICE = [
  { urls:'stun:stun.l.google.com:19302' },
  { urls:['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username:'openrelayproject', credential:'openrelayproject' },
];
const BLOCKED = 'Couldn’t connect to someone: a network is blocking direct connections (common on mobile data and office Wi-Fi). Try home Wi-Fi.';

export const events = {
  onStatus: () => {},          // (text) plain-language connection status
  onMember: () => {},          // (id, name) someone is now in the room
  onVideo: () => {},           // (id, stream) their camera
  onLeave: () => {},           // (id)
  onMessage: () => {},         // (msg, fromId) band/session messages
};
export const peers = new Map();   // id -> { conn, audio, name, rtt, offset, samples, lastSeq, recv, lost, video }
window.jamPeers = peers;          // for automated tests
window.jamNet = { setFakeLoss: s => setFakeLoss(s), setMaxFill: n => setMaxFill(n) };
let peer = null, video = null, joinId = null, seq = 0, roomFull = false;
// What you send: 16-bit is CD quality; 32-bit float ("Studio quality") has more
// headroom and doubles the bandwidth. Channels follow the input (mono or stereo).
export const format = { bits: 16 };
const pkt = new Uint8Array(packetBytes(FRAMES, 2, 32));   // big enough for stereo 32-bit

export const isOwner = () => !joinId;
export const roomId = () => joinId || me.id;   // the room is named after its creator
export const roomCount = () => 1 + [...peers.values()].filter(p => p.name).length;
export const offsetTo = id => (peers.get(id) || {}).offset || 0;   // their clock - mine (ms)
export const clockSynced = id => ((peers.get(id) || {}).samples || []).length >= 3;
export function send(msg, to){ for(const [id, p] of peers) if((!to || to === id) && p.conn && p.conn.open) p.conn.send(msg); }

// Your instrument: one packet per 128-frame block ([mono] or [left, right]), sent to every open audio channel.
// capturedAt: wall-clock ms the block was captured, so receivers can measure
// how long it really took to arrive (phone audio stacks, send queues, network).
// Recording taps (mixrec.js): every block you send and every block you receive.
export const taps = { local: null, remote: null, listen: null, tracks: null };   // listen: the AI soloist's ear (id or 'me', planes, when played); tracks: separate-track recording (same)
// "Pretend we're far apart" (testing at home): every player's audio arrives this much later, as if across the world.
let fakeDelay = 0;
export const setFakeDelay = ms => { fakeDelay = ms; peers.forEach(p => { p.ages = []; }); };
let fakeLoss = 0;   // tests: drop this share of incoming audio packets, like a lossy long-distance link
export const setFakeLoss = share => { fakeLoss = share; };
// A lost block (or a few) would leave the other player's buffer short, so it runs
// dry soon after and has to grow (more delay). Fill the gap with the last block,
// fading, so the timing holds and the buffer can stay small. (Packet-loss concealment.)
let MAX_FILL = 4;
export const setMaxFill = n => { MAX_FILL = n; };   // tests
function conceal(last, k){
  const out = [];
  for(let j = 0; j < k; j++){
    const a = Math.pow(0.6, j), b = Math.pow(0.6, j + 1);
    out.push(last.map(pl => { const n = pl.length, o = new Float32Array(n); for(let i = 0; i < n; i++) o[i] = pl[i] * (a + (b - a) * i / n); return o; }));
  }
  return out;
}
// Trade bars (trade.js) decides what happens to each incoming block: undefined =
// play now (free jam), null = drop (not their turn), a time = play then (wall-clock ms).
export let route = () => undefined;
export const setRoute = fn => { route = fn; };
// How loud each player sounds, when you hear it (avatars): id -> [[at, peak], ...]; 'me' = you.
export const levels = new Map();
const peakOf = a => { let m = 0; for(let i = 0; i < a.length; i += 2){ const v = a[i] < 0 ? -a[i] : a[i]; if(v > m) m = v; } return m; };
function noteLevel(id, at, v){
  let q = levels.get(id); if(!q){ q = []; levels.set(id, q); }
  const last = q[q.length - 1];
  if(last && at - last[0] < 20){ if(v > last[1]) last[1] = v; return; }   // one entry per ~20 ms
  q.push([at, v]); if(q.length > 400) q.splice(0, q.length - 400);
}
export function levelNow(id){
  const q = levels.get(id), now = clk(); if(!q) return 0;
  while(q.length > 1 && q[1][0] <= now) q.shift();
  return q[0] && q[0][0] <= now && now - q[0][0] < 150 ? q[0][1] : 0;
}
// Your own mix: each player's volume (by id; 1 = as sent), and a boost for your input
// before it goes to the others. Applied to the audio itself, so the browser and the
// desktop app both get it.
export const gains = new Map();
let inputGain = 1;
export const setInputGain = g => { inputGain = g; };
const scale = (planes, g) => { for(const pl of planes) for(let i = 0; i < pl.length; i++){ const v = pl[i] * g; pl[i] = v > 1 ? 1 : v < -1 ? -1 : v; } };
// Echo test (latency measurement): send each player's audio straight back to
// them, and nothing of your own, so they can time the round trip (see /latency-test).
export let echo = false;
export function setEcho(on){ echo = on; if(audio.setDirectEcho) audio.setDirectEcho(on); }
function echoBack(id, p, planes){
  if(!p.audio || p.audio.readyState !== 'open') return;
  const n = encodePacket(pkt, { seq:seq++, timeUs:clk() * 1000, sampleRate:RATE, frames:planes[0].length, wantChannels:1, planes, bits:16 });
  p.audio.send(pkt.subarray(0, n));
}
export function sendBlock(planes, capturedAt){
  if(echo) return;   // echo test: only the others' audio goes back
  if(inputGain !== 1) scale(planes, inputGain);
  if(taps.local) taps.local(planes);
  noteLevel('me', clk(), peakOf(planes[0]));
  if(taps.listen) taps.listen('me', planes, (capturedAt || clk()) - audio.inputLatencyMs());
  if(taps.tracks) taps.tracks('me', planes, (capturedAt || clk()) - audio.inputLatencyMs());
  let n = 0;
  for(const p of peers.values()){
    if(p.directSend) continue;   // their app gets yours straight from your app (direct path)
    if(!p.audio || p.audio.readyState !== 'open') continue;
    // Never let audio queue up behind a slow connection: late audio is useless, drop it.
    if(p.audio.bufferedAmount > 16 * 1100){ p.dropped = (p.dropped || 0) + 1; continue; }
    if(!n) n = encodePacket(pkt, { seq:seq++, timeUs:(capturedAt || clk())*1000, sampleRate:RATE, frames:FRAMES, wantChannels:1, planes, bits:format.bits });
    p.audio.send(pkt.subarray(0, n));
  }
}

// Clock offset to one person (their clock - mine), from the fastest ping round trip.
function clockSample(p, sentAt, theirAt){
  const now = clk(), rtt = now - sentAt;
  p.samples.push({ rtt, off: theirAt - (sentAt + rtt / 2) }); if(p.samples.length > 20) p.samples.shift();
  p.rtt = rtt; p.offset = p.samples.reduce((a, b) => b.rtt < a.rtt ? b : a).off;
}

function onData(m, id){
  const p = peers.get(id); if(!m || !p) return;
  if(m.ping !== undefined){ send({ pong:m.ping, at:clk() }, id); return; }
  if(m.pong !== undefined){ clockSample(p, m.pong, m.at); return; }
  if(m.t === 'hello'){
    p.name = m.name; p.version = m.v; p.inMs = m.inMs; p.outMs = m.outMs;
    if(m.direct && !p.directOffered){ p.directOffered = true; offerDirect(id); }   // both are 0.6.0+ apps: try app to app
    events.onMember(id, m.name);
    if(p.video) events.onVideo(id, p.video);
    // the owner introduces a newcomer to everyone else already here
    if(isOwner() && m.newcomer) send({ t:'members', ids:[...peers.keys()].filter(x => x !== id && peers.get(x).name) }, id);
  }
  else if(m.t === 'members'){ m.ids.forEach(x => { if(x !== me.id && !peers.has(x)) dial(x, false); }); return; }
  else if(m.t === 'lat'){ p.inMs = m.inMs; p.outMs = m.outMs; return; }
  else if(m.t === 'direct'){ if(audio.directPeer) audio.directPeer(id, m.token, m.addrs); return; }
  else if(m.t === 'full'){ roomFull = true; events.onStatus('This room is full (4 players max). Ask the others to make space, or start a new room.'); return; }
  events.onMessage(m, id);
}

function removePeer(id){
  if(!peers.has(id)) return;
  peers.delete(id); audio.forget(id); if(audio.directGone) audio.directGone(id);
  events.onLeave(id);
}

// One reliable control connection + one raw audio channel per person.
// One block of another player's audio, from WebRTC or straight from their app
// (direct: the engine already played it if it's a free jam). arrived: when it
// got here, on this page's clock.
function receive(id, p, pk, direct, arrived){
  const sk = direct ? 'dSeq' : 'lastSeq';
  let gap = 0;
  if(p[sk] != null){ const d = seqDelta(p[sk], pk.seq); if(d <= 0) return; if(d > 1){ p.lost += d - 1; gap = d - 1; } }
  // age: from their capture to arriving here, on the shared clock (offset = their clock - mine)
  if(p.samples.length){
    const age = arrived - (pk.timeUs / 1000 - p.offset);
    p.ages.push(age); if(p.ages.length > 375) p.ages.shift();
    // the slowest arrival of each of the last 15 seconds (BARS sizes its wait on these, not one second's worth)
    const sec = Math.floor(arrived / 1000);
    if(p.maxSec !== sec){ p.maxSec = sec; p.maxes = (p.maxes || []).concat(age).slice(-15); }
    else if(age > p.maxes[p.maxes.length - 1]) p.maxes[p.maxes.length - 1] = age;
  }
  p[sk] = pk.seq; p.recv++; p.format = `${pk.planes.length}ch/${pk.bits}bit`; p.frames = pk.planes[0].length;
  const at = route(id, p.samples.length ? pk.timeUs / 1000 - p.offset : null, p, pk.planes);
  if(at === null){ p.muted = (p.muted || 0) + 1; p.last = null; return; }
  const played = direct && at === undefined && directPlay;   // the app's engine has it already
  const g = gains.get(id); if(g != null && g !== 1) scale(pk.planes, g);
  // with `at` (BARS, far apart) each fill goes exactly where the lost block would have played
  if(gap && gap <= MAX_FILL && p.last && !played){
    const blockMs = pk.planes[0].length / RATE * 1000;
    conceal(p.last, gap).forEach((f, j) => audio.deliver(id, f, at == null ? at : at - (gap - j) * blockMs));
    p.filled = (p.filled || 0) + gap;
  }
  p.last = pk.planes;
  if(!played) audio.deliver(id, pk.planes, at);
  if(taps.remote) taps.remote(id, pk.planes);
  if(taps.listen) taps.listen(id, pk.planes, at == null ? clk() : at);
  if(taps.tracks) taps.tracks(id, pk.planes, at == null ? clk() + (((audio.stats.players || {})[id] || {}).bufferMs || 0) : at);   // when you heard it
  noteLevel(id, at == null ? clk() : at, peakOf(pk.planes[0]));
}

// ---- the direct path: app to app over UDP (desktop app 0.6.0+ on both ends) ----
// The apps swap addresses and tokens over this encrypted control channel, punch
// through their routers, and once a path works both ways audio skips WebRTC.
// In a free jam the receiving engine plays it at once; in BARS this page still
// decides when each block plays (setDirectPlay follows trade.js).
export let directPlay = true;
export function setDirectPlay(on){ if(on === directPlay) return; directPlay = on; if(audio.setDirectPlay) audio.setDirectPlay(on); }
export function setGain(id, g){ if(g === 1) gains.delete(id); else gains.set(id, g); if(audio.setDirectGain) audio.setDirectGain(id, g); }
export function setBits(bits){ format.bits = bits; if(audio.setDirectBits) audio.setDirectBits(bits); }
function offerDirect(id){
  if(!audio.canDirect || !audio.canDirect()) return;
  audio.setDirectBits(format.bits);
  audio.directInfo().then(info => send({ t:'direct', token:info.token, addrs:info.addrs }, id)).catch(e => console.warn('direct audio unavailable', e));
}
if(audio.direct){
  audio.direct.onState = (id, sendOk, recvOk) => { const p = peers.get(id); if(p){ p.directSend = sendOk; p.directRecv = recvOk; } };
  audio.direct.onBlock = (id, b) => { const p = peers.get(id); if(!p) return; p.directAt = clk(); receive(id, p, { seq:b.seq, timeUs:b.timeMs * 1000, planes:b.planes, bits:b.bits }, true, b.arrived); };
}

function wireConn(c, newcomer){
  const id = c.peer, old = peers.get(id);
  if(old && old.conn !== c){ try{ old.conn.close(); }catch(e){} }
  const p = { conn:c, audio:null, name:old && old.name, rtt:null, offset:0, samples:[], ages:[], lastSeq:null, recv:0, lost:0, video:old && old.video };
  peers.set(id, p);
  c.on('open', () => {
    p.audio = c.peerConnection.createDataChannel('audio', { negotiated:true, id:7, ordered:false, maxRetransmits:0 });
    p.audio.binaryType = 'arraybuffer';
    p.audio.onmessage = e => { if(fakeLoss && Math.random() < fakeLoss) return; if(fakeDelay) setTimeout(() => onAudio(e), fakeDelay); else onAudio(e); };
    const onAudio = e => {
      if(clk() - (p.directAt || 0) < 300) return;   // their audio is arriving app to app (direct path): ignore the backup copy
      const pk = decodePacket(new Uint8Array(e.data)); if(!pk || peers.get(id) !== p) return;
      if(echo){ echoBack(id, p, pk.planes); return; }   // echo test: straight back, not played here
      receive(id, p, pk, false, clk());
    };
    const pc = c.peerConnection;
    pc.addEventListener('iceconnectionstatechange', () => { if(pc.iceConnectionState === 'failed') events.onStatus(BLOCKED); });
    send({ t:'hello', v:PROTOCOL_VERSION, id:me.id, name:me.name, newcomer, inMs:audio.inputLatencyMs(), outMs:audio.outputLatencyMs(), direct:!!(audio.canDirect && audio.canDirect()) }, id);
    for(let i = 0; i < 8; i++) setTimeout(() => send({ ping:clk() }, id), 150 * i);   // quick initial clock sync
  });
  c.on('data', m => onData(m, id));
  c.on('close', () => { if(peers.get(id) && peers.get(id).conn === c) removePeer(id); });
  setTimeout(() => { if(peers.get(id) === p && (!p.audio || p.audio.readyState !== 'open')) events.onStatus(BLOCKED); }, 20000);
}
function dial(id, newcomer){
  wireConn(peer.connect(id, { serialization:'json', reliable:true }), newcomer);
  const call = peer.call(id, video);
  call.on('stream', s => gotVideo(id, s));
}
function gotVideo(id, s){ const p = peers.get(id); if(p) p.video = s; if(p && p.name) events.onVideo(id, s); }

// Join (joinId set) or create a room. Resolves with my id once the broker knows me.
// broker: optional "host:port" of a self-hosted PeerJS broker (used by tests).
export async function open({ join, broker, videoStream }){
  joinId = join; video = videoStream;
  const [bh, bp] = (broker || '').split(':');
  peer = new Peer(Object.assign({ config:{ iceServers:ICE } }, broker ? { host:bh, port:+bp, path:'/', secure:false } : {}));
  me.id = await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); });
  peer.on('error', e => events.onStatus(e.type === 'peer-unavailable' ? (peers.size ? 'Someone in the room couldn’t be reached.' : 'That invite link has expired (it changes whenever the room’s creator reloads). Ask for a fresh one.') : 'Connection problem: ' + (e.type || e.message)));
  peer.on('connection', c => {
    if(roomCount() >= MAX_ROOM && !peers.has(c.peer)){ c.on('open', () => { const tell = setInterval(() => c.open && c.send({ t:'full' }), 400); setTimeout(() => { clearInterval(tell); c.close(); }, 6000); }); return; }
    wireConn(c, false);
  });
  // A video call can arrive just before its control connection; wait briefly for it.
  peer.on('call', call => { let n = 0; const answer = () => { if(peers.has(call.peer)){ call.answer(video); call.on('stream', s => gotVideo(call.peer, s)); } else if(n++ < 25) setTimeout(answer, 200); }; answer(); });
  if(joinId){
    dial(joinId, true); events.onStatus('Connecting…');
    let tries = 1;
    const retry = setInterval(() => {
      const o = peers.get(joinId);
      if((o && o.name) || roomFull){ clearInterval(retry); return; }
      if(tries >= 3){ clearInterval(retry); setTimeout(() => { const o2 = peers.get(joinId); if(!(o2 && o2.name) && !roomFull) events.onStatus('Couldn’t join this room. It may be full (4 players max), or the person who created it has left.'); }, 8000); return; }
      tries++; events.onStatus(`Still connecting… (attempt ${tries})`); dial(joinId, true);
    }, 8000);
  }
  setInterval(() => send({ ping:clk() }), 1000);
  setInterval(() => send({ t:'lat', inMs:audio.inputLatencyMs(), outMs:audio.outputLatencyMs() }), 5000);   // devices can change
  return me.id;
}
export function leave(){ try{ peers.forEach(p => p.conn.close()); peer && peer.destroy(); }catch(e){} }
// Closing the tab or window counts as leaving straight away (the others don't wait for the connection to time out).
addEventListener('pagehide', leave);

// Snapshot for the connection panel.
// Which path each person's audio takes: straight between the two devices, or
// through the relay server (slower; over TCP it also stutters). From WebRTC's stats.
async function checkRoute(p){
  const pc = p.conn && p.conn.peerConnection; if(!pc || !pc.getStats) return;
  try{
    const st = await pc.getStats(); let pair = null;
    st.forEach(r => { if(r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
    if(!pair) st.forEach(r => { if(r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    if(!pair) return;
    const loc = st.get(pair.localCandidateId), rem = st.get(pair.remoteCandidateId);
    const relay = [loc, rem].some(c => c && c.candidateType === 'relay');
    const tcp = [loc, rem].some(c => c && (c.protocol === 'tcp' || c.relayProtocol === 'tcp' || c.relayProtocol === 'tls'));
    p.route = relay ? (tcp ? 'relay-tcp' : 'relay') : (tcp ? 'direct-tcp' : 'direct');
    if(pair.currentRoundTripTime) p.pathRtt = pair.currentRoundTripTime * 1000;
  }catch(e){}
}
setInterval(() => peers.forEach(p => { if(p.name) checkRoute(p); }), 2000);

export function connectionStats(){
  const live = [...peers.values()].filter(p => p.name && p.recv);
  const recv = live.reduce((a, p) => a + p.recv, 0), lost = live.reduce((a, p) => a + p.lost, 0);
  const myOut = audio.outputLatencyMs(), bufs = audio.stats.players || {};
  return {
    live: live.length,
    oneWayMs: live.map(p => p.rtt === null ? null : Math.round(p.rtt / 2)),
    // Estimated time from their instrument to your ears: their input + one packet
    // + network + your buffer for them + your output.
    players: [...peers.entries()].filter(([, p]) => p.name && p.recv).map(([id, p]) => {
      const net = (p.rtt === null ? 0 : p.rtt / 2) + fakeDelay, buf = (bufs[id] || {}).bufferMs || 0;   // pretending to be far apart counts as distance
      // measured: their capture -> arrival here (typical of the last second), else the estimate
      const age = p.ages.length > 50 ? [...p.ages].sort((a, b) => a - b)[p.ages.length >> 1] : FRAMES / RATE * 1000 + net;
      // the budget: where the time goes, their instrument -> your ears
      const sorted = p.ages.length > 50 ? [...p.ages].sort((a, b) => a - b) : null;
      const jitter = sorted ? Math.max(0, sorted[Math.floor(sorted.length * 0.95)] - sorted[sorted.length >> 1]) : 0;
      const block = FRAMES / RATE * 1000;
      const budget = { in: Math.round(p.inMs || 0), packet: Math.round((clk() - (p.directAt || 0) < 1000 ? (p.frames || 64) / RATE * 1000 : block) * 10) / 10, network: Math.round(net), jitter: Math.round(jitter), buffer: Math.round(buf), out: Math.round(myOut) };
      return { name: p.name, netMs: Math.round(net), arriveMs: Math.round(age), bufferMs: buf, totalMs: Math.round((p.inMs || 0) + age + buf + myOut), route: clk() - (p.directAt || 0) < 1000 ? 'app' : p.route || null, budget };
    }),
    lossPct: recv ? 100 * lost / (recv + lost) : 0,
    debug: [...peers.entries()].map(([id, p]) => `${p.name || id.slice(0,6)}: ${p.conn.open ? 'open' : 'opening'}/${p.conn.peerConnection ? p.conn.peerConnection.iceConnectionState : '–'}/${p.audio ? p.audio.readyState : '–'}`).join(' · ') || 'nobody yet',
  };
}
