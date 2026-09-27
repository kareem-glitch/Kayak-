// Entry point: the join screen, wiring between modules, and the controls.
import { $, clamp } from './util.js';
import { S, me } from './state.js';
import * as audio from './audio/io.js';
import * as band from './band/engine.js';
import * as room from './net/room.js';
import * as session from './session.js';
import * as ui from './ui.js';

const params = new URLSearchParams(location.search);
// If this tab created the room and got reloaded, its old invite id is dead: create again.
let joinId = params.get('join');
try{ if(joinId && sessionStorage.getItem('ss.hostId') === joinId){ joinId = null; history.replaceState(null, '', location.pathname); } }catch(e){}
let inviteLink = null, media = null;
const store = { get: k => { try{ return localStorage.getItem(k); }catch(e){ return null; } }, set: (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} } };

// ---- module wiring ----
band.hooks.onBeat = ui.showBeat;
band.hooks.onChange = ui.render;
session.hooks.onChange = ui.render;
room.events.onStatus = ui.status;
room.events.onMember = (id, name) => { ui.tileFor({ identity:id, name }); $('#bigInvite').hidden = !room.isOwner() || room.roomCount() >= room.MAX_ROOM; showRoomStatus(); ui.render(); };
room.events.onVideo = (id, stream) => { const p = room.peers.get(id); ui.showVideoIn(ui.tileFor({ identity:id, name:p && p.name }), stream); };
room.events.onLeave = id => { ui.removeTile(id); session.peerLeft(id); $('#bigInvite').hidden = !room.isOwner() || room.roomCount() >= room.MAX_ROOM; showRoomStatus(); ui.render(); };
room.events.onMessage = session.handleMessage;

function showRoomStatus(){
  const names = [...room.peers.values()].filter(p => p.name).map(p => p.name);
  ui.status(names.length ? `In the room: you, ${names.join(', ')} (${room.roomCount()}/${room.MAX_ROOM})` : (room.isOwner() ? 'Send this invite link to up to 3 friends:' : 'Connecting…'));
}

// ---- join ----
async function join(){
  const name = $('#nameInput').value.trim();
  if(!name){ $('#joinErr').textContent = 'Add your name so the band knows who you are.'; return; }
  me.name = name; $('#joinBtn').disabled = true; $('#joinErr').textContent = '';
  Tone.start();   // unlock audio inside the click so the band can start later without another tap
  try{
    const savedIn = store.get('ss.inDev') || '';
    const audioReq = Object.assign({}, audio.MIC_OPTS, savedIn ? { deviceId:{ ideal:savedIn } } : {});
    try{ media = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480 }, audio:audioReq }); }
    catch(e){ media = await navigator.mediaDevices.getUserMedia({ audio:audioReq }); }
    let audioProblem = null;
    try{ await audio.start(media, room.sendBlock); audio.setMaxQueue(+$('#buffer').value); }
    catch(e){ audioProblem = e; console.error('audio setup failed', e); }
    const videoOnly = new MediaStream(media.getVideoTracks());
    await room.open({ join:joinId, broker:params.get('broker'), videoStream:videoOnly });
    $('#joinView').hidden = true; $('#roomView').hidden = false; $('#roomTitle').textContent = 'SoundStudio jam';
    const t = ui.tileFor({ identity:me.id, name:me.name }); if(media.getVideoTracks().length) ui.showVideoIn(t, videoOnly);
    if(joinId) inviteLink = location.href;
    else {
      inviteLink = location.origin + location.pathname + '?join=' + me.id + (params.get('broker') ? '&broker=' + params.get('broker') : '');
      history.replaceState(null, '', inviteLink);   // copying the address bar works too
      try{ sessionStorage.setItem('ss.hostId', me.id); }catch(e){}
      showRoomStatus(); $('#bigInvite').hidden = false;
    }
    if(!audioProblem){
      await fillDevices().catch(() => {});
      const o = store.get('ss.outDev'); if(o) await audio.useOutput(o);
      navigator.mediaDevices.addEventListener('devicechange', () => fillDevices().catch(() => {}));
    }
    ui.render();
    if(audioProblem) ui.status('Audio couldn’t start on this device (' + (audioProblem.name || audioProblem) + '). Video still works.');
    setInterval(showConnection, 250);
  }catch(e){
    $('#joinErr').textContent = 'Couldn’t start: ' + (e.message || e.type || e) + '. Allow camera and microphone, then try again.'; $('#joinBtn').disabled = false;
  }
}

function showConnection(){
  const c = room.connectionStats();
  $('#connDebug').textContent = `me ${me.id.slice(0,6)} · ${room.isOwner() ? 'room creator' : 'joined'} · ${c.debug}`;
  if(!c.live) return;
  const net = c.oneWayMs.map(v => v === null ? '–' : v + ' ms').join(', ');
  $('#connStats').innerHTML = `<span>In the room: ${room.roomCount()}/${room.MAX_ROOM}</span><span>Network ≈ ${net}</span><span>Buffer ${Math.round($('#buffer').value * audio.BLOCK_MS)} ms</span><span>Your output ${audio.outputLatencyMs()} ms</span><span>Lost ${c.lossPct.toFixed(1)}%</span><span>Dropouts ${audio.stats.under}</span>`;
}

// ---- audio devices ----
async function fillDevices(){
  const { inputs, outputs } = await audio.listDevices();
  ui.fillSelect($('#inDev'), inputs, audio.currentInputId() || store.get('ss.inDev') || '');
  const canOut = audio.canChooseOutput();
  $('#outDev').hidden = !canOut; $('#outNote').hidden = canOut;
  if(canOut) ui.fillSelect($('#outDev'), outputs, store.get('ss.outDev') || '');
}
const showChannels = chans => { $('#inCh').disabled = chans < 2; };
$('#inDev').onchange = () => audio.useInput($('#inDev').value).then(ch => { store.set('ss.inDev', $('#inDev').value); showChannels(ch); return fillDevices(); }).catch(e => ui.status('Couldn’t switch input: ' + (e.name || e)));
$('#inCh').onchange = () => showChannels(audio.setInputChannel($('#inCh').value));
$('#outDev').onchange = () => { store.set('ss.outDev', $('#outDev').value); audio.useOutput($('#outDev').value); };

// ---- controls ----
if(joinId) $('#roomLine').textContent = 'You’ve been invited to a jam. Add your name and join.';
$('#nameInput').value = store.get('ss.name') || '';
$('#nameInput').addEventListener('input', () => store.set('ss.name', $('#nameInput').value));
$('#nameInput').addEventListener('keydown', e => { if(e.key === 'Enter') join(); });
$('#joinBtn').onclick = join;
$('#claimBtn').onclick = async () => { if(!await session.claimBand()) $('#claimStatus').textContent = S.hostName + ' is already running the band.'; };
async function generate(){
  const prompt = $('#prompt').value.trim();
  if(!prompt){ $('#genStatus').textContent = 'Describe the jam first, for example “slow funk in E minor”.'; return; }
  $('#genBtn').disabled = true; $('#genStatus').textContent = 'Writing the arrangement…';
  $('#genStatus').textContent = await session.generate(prompt);
  $('#genBtn').disabled = false;
}
$('#genBtn').onclick = generate;
$('#playBtn').onclick = () => S.playing ? session.stopBand() : session.startBand($('#countIn').checked);
$('#clickAll').onchange = () => { band.options.click = $('#clickAll').checked; };
$('#bpm').addEventListener('change', () => session.setTempo(clamp(Math.round(+$('#bpm').value || S.arr.bpm), 50, 200)));
const showBuffer = () => { $('#bufferMs').textContent = '≈ ' + Math.round($('#buffer').value * audio.BLOCK_MS) + ' ms'; };
$('#buffer').oninput = () => { showBuffer(); audio.setMaxQueue(+$('#buffer').value); }; showBuffer();
const copy = async (btn, text, done) => { try{ await navigator.clipboard.writeText(inviteLink); const t = btn.textContent; btn.textContent = done; setTimeout(() => btn.textContent = t, 2000); }catch(e){ prompt('Copy this invite link', inviteLink); } };
$('#inviteBtn').onclick = () => copy($('#inviteBtn'), inviteLink, 'Link copied');
$('#bigInvite').onclick = () => copy($('#bigInvite'), inviteLink, 'Link copied. Send it to your friends');
$('#leaveBtn').onclick = () => { room.leave(); location.href = location.pathname; };
$('#micBtn').onclick = () => { const on = !audio.micEnabled(); audio.setMicEnabled(on); $('#micBtn').textContent = on ? 'Mic on' : 'Mic off'; $('#micBtn').setAttribute('aria-pressed', String(on)); };
$('#camBtn').onclick = () => { const v = media && media.getVideoTracks()[0]; if(!v) return; v.enabled = !v.enabled; $('#camBtn').textContent = v.enabled ? 'Camera on' : 'Camera off'; $('#camBtn').setAttribute('aria-pressed', String(v.enabled)); };
const bandVol = v => { $('#bandVolDb').textContent = v <= -40 ? '(off)' : '(' + (v > 0 ? '+' : '') + v + ' dB)'; band.options.bandVolumeDb = v; band.applyBandVolume(); };
if(store.get('ss.bandVol') !== null) $('#bandVol').value = store.get('ss.bandVol');
$('#bandVol').oninput = () => { bandVol(+$('#bandVol').value); store.set('ss.bandVol', $('#bandVol').value); };
bandVol(+$('#bandVol').value);
['Slow funk in E minor, 96 bpm','12-bar blues shuffle in A','Lo-fi hip hop for a rainy night','Reggae one drop in G','Up-tempo jazz ii-V-I in Bb','Driving indie rock in D'].forEach(t => {
  const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.onclick = () => { $('#prompt').value = t; generate(); }; $('#examples').appendChild(b);
});

// for automated tests
window.getInvite = () => inviteLink;
window.jamEngine = band.engine;
window.jamStats = audio.stats;
