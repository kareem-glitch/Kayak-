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
let peer = null, video = null, joinId = null, seq = 0, roomFull = false;
// What you send: 16-bit is CD quality; 32-bit float ("Studio quality") has more
// headroom and doubles the bandwidth. Channels follow the input (mono or stereo).
export const format = { bits: 16 };
const pkt = new Uint8Array(packetBytes(FRAMES, 2, 32));   // big enough for stereo 32-bit

export const isOwner = () => !joinId;
export const roomCount = () => 1 + [...peers.values()].filter(p => p.name).length;
export const offsetTo = id => (peers.get(id) || {}).offset || 0;   // their clock - mine (ms)
export const clockSynced = id => ((peers.get(id) || {}).samples || []).length >= 3;
export function send(msg, to){ for(const [id, p] of peers) if((!to || to === id) && p.conn && p.conn.open) p.conn.send(msg); }

// Your instrument: one packet per 128-frame block ([mono] or [left, right]), sent to every open audio channel.
export function sendBlock(planes){
  let n = 0;
  for(const p of peers.values()){
    if(!p.audio || p.audio.readyState !== 'open') continue;
    if(!n) n = encodePacket(pkt, { seq:seq++, timeUs:clk()*1000, sampleRate:RATE, frames:FRAMES, wantChannels:1, planes, bits:format.bits });
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
    events.onMember(id, m.name);
    if(p.video) events.onVideo(id, p.video);
    // the owner introduces a newcomer to everyone else already here
    if(isOwner() && m.newcomer) send({ t:'members', ids:[...peers.keys()].filter(x => x !== id && peers.get(x).name) }, id);
  }
  else if(m.t === 'members'){ m.ids.forEach(x => { if(x !== me.id && !peers.has(x)) dial(x, false); }); return; }
  else if(m.t === 'lat'){ p.inMs = m.inMs; p.outMs = m.outMs; return; }
  else if(m.t === 'full'){ roomFull = true; events.onStatus('This room is full (4 players max). Ask the others to make space, or start a new room.'); return; }
  events.onMessage(m, id);
}

function removePeer(id){
  if(!peers.has(id)) return;
  peers.delete(id); audio.forget(id);
  events.onLeave(id);
}

// One reliable control connection + one raw audio channel per person.
function wireConn(c, newcomer){
  const id = c.peer, old = peers.get(id);
  if(old && old.conn !== c){ try{ old.conn.close(); }catch(e){} }
  const p = { conn:c, audio:null, name:old && old.name, rtt:null, offset:0, samples:[], lastSeq:null, recv:0, lost:0, video:old && old.video };
  peers.set(id, p);
  c.on('open', () => {
    p.audio = c.peerConnection.createDataChannel('audio', { negotiated:true, id:7, ordered:false, maxRetransmits:0 });
    p.audio.binaryType = 'arraybuffer';
    p.audio.onmessage = e => {
      const pk = decodePacket(new Uint8Array(e.data)); if(!pk) return;
      if(p.lastSeq !== null){ const d = seqDelta(p.lastSeq, pk.seq); if(d <= 0) return; if(d > 1) p.lost += d - 1; }
      p.lastSeq = pk.seq; p.recv++; p.format = `${pk.planes.length}ch/${pk.bits}bit`;
      audio.deliver(id, pk.planes);
    };
    const pc = c.peerConnection;
    pc.addEventListener('iceconnectionstatechange', () => { if(pc.iceConnectionState === 'failed') events.onStatus(BLOCKED); });
    send({ t:'hello', v:PROTOCOL_VERSION, id:me.id, name:me.name, newcomer, inMs:audio.inputLatencyMs(), outMs:audio.outputLatencyMs() }, id);
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

// Snapshot for the connection panel.
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
      const net = p.rtt === null ? 0 : p.rtt / 2, buf = (bufs[id] || {}).bufferMs || 0;
      return { name: p.name, netMs: Math.round(net), bufferMs: buf, totalMs: Math.round((p.inMs || 0) + FRAMES / RATE * 1000 + net + buf + myOut) };
    }),
    lossPct: recv ? 100 * lost / (recv + lost) : 0,
    debug: [...peers.entries()].map(([id, p]) => `${p.name || id.slice(0,6)}: ${p.conn.open ? 'open' : 'opening'}/${p.conn.peerConnection ? p.conn.peerConnection.iceConnectionState : '–'}/${p.audio ? p.audio.readyState : '–'}`).join(' · ') || 'nobody yet',
  };
}
