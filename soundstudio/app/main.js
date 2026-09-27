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
    const audioReq = Object.assign(audio.micOptions($('#speaker').checked), savedIn ? { deviceId:{ ideal:savedIn } } : {});
    try{ media = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480 }, audio:audioReq }); }
    catch(e){ media = await navigator.mediaDevices.getUserMedia({ audio:audioReq }); }
    let audioProblem = null;
    try{ audio.setInputChannel($('#inCh').value); await audio.start(media, room.sendBlock); audio.setBufferLimit(+$('#buffer').value); }
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
  showConnection.n = (showConnection.n || 0) + 1;
  if(showConnection.n % 8 === 1) checkSetup(c);   // every 2 s
  if(!c.live) return;
  $('#connStats').innerHTML = `<span>In the room: ${room.roomCount()}/${room.MAX_ROOM}</span><span>Your input ${audio.inputLatencyMs()} ms · output ${audio.outputLatencyMs()} ms</span><span>Lost ${c.lossPct.toFixed(1)}%</span><span>Dropouts ${audio.stats.under}</span>`;
  // per player: estimated time from their instrument to your ears
  $('#latList').innerHTML = c.players.map(p => `<li><span><b>${p.name.replace(/[<&]/g, '')}</b> → you</span><span>≈ ${p.totalMs} ms <span class="muted">(network ${p.netMs}, buffer ${p.bufferMs})</span></span></li>`).join('');
}

// ---- setup check: plain-language tips for the tightest feel ----
function checkSetup(c){
  const tips = [], out = $('#outDev').selectedOptions[0], inp = $('#inDev').selectedOptions[0];
  const names = [(out && out.textContent) || '', (inp && inp.textContent) || ''].join(' ');
  if($('#speaker').checked) tips.push(['info', 'Echo cancellation is on: no feedback from your speaker, but sound is less clean. With wired headphones, turn it off for the best sound.']);
  else tips.push(['info', 'Using a loudspeaker without headphones? Turn on Echo cancellation.']);
  if(/bluetooth|airpods|buds|beats|headset \(|hands-free/i.test(names)) tips.push(['warn', 'Bluetooth detected: it adds 100+ ms. Use wired headphones or your interface.']);
  else tips.push(['ok', 'No Bluetooth audio detected.']);
  const sr = audio.inputSampleRate();
  if(sr && sr !== 48000) tips.push(['warn', `Your input runs at ${sr / 1000} kHz. Set your interface to 48 kHz to avoid extra conversion.`]);
  else if(sr) tips.push(['ok', 'Input at 48 kHz.']);
  const far = c.players.filter(p => p.netMs > 30);
  if(far.length) tips.push(['warn', `${far.map(p => p.name).join(', ')} ${far.length > 1 ? 'are' : 'is'} far away on the network (${far.map(p => p.netMs + ' ms').join(', ')}). Tight rhythm works best under ~25 ms.`]);
  const ua = navigator.userAgent;
  if(!/Chrome|Edg\//.test(ua) || /Firefox/.test(ua)) tips.push(['info', 'Chrome or Edge give the lowest audio delay.']);
  if(/Windows/.test(ua)) tips.push(['info', 'Windows browsers add some audio delay; a Mac is tighter.']);
  if(navigator.connection && navigator.connection.type === 'wifi') tips.push(['info', 'You’re on Wi-Fi. An Ethernet cable is steadier.']);
  tips.push(['info', 'Use your interface’s direct monitoring to hear yourself with no delay.']);
  $('#tips').innerHTML = tips.map(([k, t]) => `<li class="${k}">${t}</li>`).join('');
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
$('#inDev').onchange = () => audio.useInput($('#inDev').value, $('#speaker').checked).then(ch => { store.set('ss.inDev', $('#inDev').value); showChannels(ch); return fillDevices(); }).catch(e => ui.status('Couldn’t switch input: ' + (e.name || e)));
$('#inCh').onchange = () => { store.set('ss.inCh', $('#inCh').value); showChannels(audio.setInputChannel($('#inCh').value)); };
$('#outDev').onchange = () => { store.set('ss.outDev', $('#outDev').value); audio.useOutput($('#outDev').value); };
// Echo cancellation: on by default for phones (often used on loudspeaker), off for computers.
$('#speaker').checked = store.get('ss.speaker') !== null ? store.get('ss.speaker') === '1' : audio.isPhone();
$('#speaker').onchange = () => { store.set('ss.speaker', $('#speaker').checked ? '1' : '0'); if(media) audio.useInput($('#inDev').value, $('#speaker').checked).then(showChannels).catch(e => ui.status('Couldn’t switch the microphone: ' + (e.name || e))); checkSetup(room.connectionStats()); };
$('#studio').checked = store.get('ss.studio') === '1'; room.format.bits = $('#studio').checked ? 32 : 16;
$('#studio').onchange = () => { room.format.bits = $('#studio').checked ? 32 : 16; store.set('ss.studio', $('#studio').checked ? '1' : '0'); };
if(store.get('ss.inCh')) $('#inCh').value = store.get('ss.inCh');

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
const showBuffer = () => { $('#bufferMs').textContent = '(' + Math.round($('#buffer').value * audio.BLOCK_MS) + ' ms)'; };
$('#buffer').oninput = () => { showBuffer(); audio.setBufferLimit(+$('#buffer').value); }; showBuffer();
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
window.jamEchoCancelling = audio.echoCancelling;
