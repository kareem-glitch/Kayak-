// Entry point: the join screen, wiring between modules, and the controls.
import { $, clamp, clk } from './util.js';
import { S, me } from './state.js';
import * as audio from './audio/io.js';
import * as band from './band/engine.js';
import * as room from './net/room.js';
import * as session from './session.js';
import * as ui from './ui.js';
import * as recording from './recording.js';
import * as lyria from './band/lyria.js';
import * as stems from './band/stems.js';
import * as trade from './trade.js';
import * as avatar from './avatar.js';
import * as synth from './synth.js';
import * as layout from './layout.js';
import { TONES, defaults as toneDefaults } from './audio/tone.js';
import * as toneIcons from './tone-icons.js';

const params = new URLSearchParams(location.search);
// If this tab created the room and got reloaded, its old invite id is dead: create again.
let joinId = params.get('join');
try{ if(joinId && sessionStorage.getItem('ss.hostId') === joinId){ joinId = null; history.replaceState(null, '', location.pathname); } }catch(e){}
let inviteLink = null, media = null, cameraProblem = null, engineFellBack = false, engineWhy = '';
// Invite links always point at the website, which the desktop app's rooms share
// (the app's own page address means nothing to anyone else).
const SITE = audio.IN_APP ? 'https://air.band/' : location.origin + location.pathname;
// A pasted invite: a full link (?join=...) or just the room code.
const inviteId = text => { const t = (text || '').trim(); if(!t) return null; const m = t.match(/[?&]join=([^&#\s]+)/); return m ? decodeURIComponent(m[1]) : (/^[\w-]{8,}$/.test(t) ? t : null); };
const store = { get: k => { try{ return localStorage.getItem(k); }catch(e){ return null; } }, set: (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} } };

// ---- module wiring ----
band.hooks.onBeat = m => { ui.showBeat(m); if(m.beat !== undefined) avatar.beat(); };
band.hooks.onChange = ui.render;
session.hooks.onChange = () => { ui.render(); autoSeat(); };
session.hooks.onNote = t => { $('#genStatus').textContent = t; };
if(params.get('band') === 'tone' || store.get('ss.band') === 'tone') session.setLyria(false);
room.events.onStatus = ui.status;
room.events.onMember = (id, name) => { ui.tileFor({ identity:id, name }); avatar.tellNewcomer(id); showRoomStatus(); ui.render(); };
room.events.onVideo = (id, stream) => { const p = room.peers.get(id); ui.showVideoIn(ui.tileFor({ identity:id, name:p && p.name }), stream); };
room.events.onLeave = id => { const t = ui.tiles.get(id); if(t) session.playerLeft(t.dataset.name); ui.removeTile(id); session.peerLeft(id); showRoomStatus(); ui.render(); };
room.events.onMessage = (m, id) => trade.handle(m, id) || avatar.handle(m, id) || session.handleMessage(m, id);
trade.hooks.onTurn = ui.showTurn; trade.start();

function showRoomStatus(){
  const names = [...room.peers.values()].filter(p => p.name).map(p => p.name);
  ui.status(names.length ? `In the room: you, ${names.join(', ')} (${room.roomCount()}/${room.MAX_ROOM})` : (room.isOwner() ? 'Send this invite link to up to 3 friends:' : 'Connecting…'));
}

// ---- join ----
async function join(){
  const name = $('#nameInput').value.trim();
  if(!name){ $('#joinErr').textContent = 'Add your name so the band knows who you are.'; return; }
  if(audio.IN_APP && $('#inviteInput').value.trim()){
    joinId = inviteId($('#inviteInput').value);
    if(!joinId){ $('#joinErr').textContent = 'That doesn’t look like an invite link. Paste the whole link, or leave it empty to start a new jam.'; return; }
  }
  me.name = name; $('#joinBtn').disabled = true; $('#joinErr').textContent = ''; cameraProblem = null;
  Tone.start();   // unlock audio inside the click so the band can start later without another tap
  try{
    const savedIn = store.get('ss.inDev') || '';
    const audioReq = Object.assign(audio.micOptions($('#speaker').checked), savedIn ? { deviceId:{ ideal:savedIn } } : {});
    if(audio.NATIVE){   // the desktop app handles audio natively: the page only needs the camera
      try{ media = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480 } }); }catch(e){ media = new MediaStream(); cameraProblem = e; }
    } else {
      try{ media = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480 }, audio:audioReq }); }
      catch(e){ media = await navigator.mediaDevices.getUserMedia({ audio:audioReq }); }
    }
    let audioProblem = null;
    const startAudio = async () => { audio.setInputChannel($('#inCh').value); await audio.start(media, room.sendBlock); audio.setBufferLimit(BUFFER_LIMIT); audio.setFeel(feel); };
    try{ await startAudio(); }
    catch(e){ audioProblem = e; console.error('audio setup failed', e); }
    // In the desktop app: if its native engine won't start or never plays, use the browser's audio instead
    const why = audio.IN_APP && audio.NATIVE ? (audioProblem ? audioProblem.message || String(audioProblem) : await audio.alive()) : '';
    if(why){
      engineWhy = why; console.warn('app audio engine: ' + why + '; switching to browser audio');
      await audio.useWeb(); audioProblem = null; engineFellBack = true; $('#speaker').closest('label').hidden = false;
      try{
        const a = await navigator.mediaDevices.getUserMedia({ audio:Object.assign(audio.micOptions($('#speaker').checked), savedIn ? { deviceId:{ ideal:savedIn } } : {}) });
        a.getAudioTracks().forEach(t => media.addTrack(t)); await startAudio();
      }catch(e){ audioProblem = e; console.error('browser audio setup failed', e); }
    }
    const videoOnly = new MediaStream(media.getVideoTracks());
    await room.open({ join:joinId, broker:params.get('broker'), videoStream:videoOnly });
    $('#joinView').hidden = true; $('#roomView').hidden = false; layout.start();
    const t = ui.tileFor({ identity:me.id, name:me.name }); if(media.getVideoTracks().length) ui.showVideoIn(t, videoOnly);
    if(joinId) inviteLink = SITE + '?join=' + joinId + (params.get('broker') ? '&broker=' + params.get('broker') : '');
    else {
      inviteLink = SITE + '?join=' + me.id + '&g=' + gamePick + (params.get('broker') ? '&broker=' + params.get('broker') : '');
      if(!audio.IN_APP) history.replaceState(null, '', inviteLink);   // copying the address bar works too
      try{ sessionStorage.setItem('ss.hostId', me.id); }catch(e){}
      showRoomStatus();
    }
    if(!audioProblem){
      if(audio.canTone() && store.get('ss.tone') && store.get('ss.tone') !== 'off') pickTone(store.get('ss.tone'));
      await fillDevices().catch(() => {});
      const o = store.get('ss.outDev'); if(o) await audio.useOutput(o);
      navigator.mediaDevices.addEventListener('devicechange', () => fillDevices().catch(() => {}));
    }
    if(look !== 'cam') setAvatar(true);
    if(!audioProblem && audio.canSynth()){ $('#synthBtn').hidden = false; $('#synthSet').hidden = false; if(store.get('ss.synth') === '1') setSynth(true); }
    if(!joinId){ S.game = gamePick === 'free' ? { mode:'free', bars:8 } : { mode:'trade', bars:+gamePick }; await session.claimBand(); }   // you started the room: you run the band
    ui.render();
    if(engineFellBack && !audioProblem) ui.status('The app’s audio engine had a problem (' + engineWhy + '), so this jam uses browser audio (a little more delay). Audio settings → Sound engine to try again.');
    else if(audioProblem) ui.status('Audio couldn’t start on this device (' + (audioProblem.message || audioProblem.name || audioProblem) + '). Video still works.');
    else if(cameraProblem) ui.status('Camera unavailable (' + (cameraProblem.name || cameraProblem) + '). Check System Settings → Privacy & Security → Camera. Audio still works.');
    setInterval(showConnection, 250);
  }catch(e){
    $('#joinErr').textContent = 'Couldn’t start: ' + (e.message || e.type || e) + '. Allow camera and microphone, then try again.'; $('#joinBtn').disabled = false;
  }
}

// ---- the DAW plugin (desktop app): install it, and see when it's your input ----
if(audio.canPlugin()){
  $('#pluginRow').hidden = false;
  $('#pluginInstall').onclick = async () => {
    const b = $('#pluginInstall'); b.disabled = true; b.textContent = 'Installing…';
    try{ const r = await audio.installPlugin(); b.textContent = 'Installed'; $('#pluginStatus').textContent = 'Installed. Restart your DAW (or rescan plugins), then add “air.band Send” to your guitar track. It goes into: ' + r.paths.join(' · '); }
    catch(e){ b.disabled = false; b.textContent = 'Install the plugin'; $('#pluginStatus').textContent = 'Couldn’t install: ' + (e.message || e); }
  };
}
let pluginWas = false;
function showPlugin(){
  const live = audio.pluginLive(); if(live === pluginWas) return; pluginWas = live;
  $('#pluginRow').classList.toggle('live', live);
  $('#inDev').disabled = live;
  if(live) $('#pluginStatus').textContent = 'Live: your DAW track is your input. Stop playback or remove the plugin to go back to your audio device.';
  else if($('#pluginInstall').textContent !== 'Installed') $('#pluginStatus').textContent = 'Put the air.band Send plugin on your guitar track (Logic, Ableton, Reaper…). Your whole chain, amp sims and all, becomes your input here.';
}

function showConnection(){
  showMix();
  if(audio.canPlugin()) showPlugin();
  const c = room.connectionStats();
  $('#connDebug').textContent = `me ${me.id.slice(0,6)} · ${room.isOwner() ? 'room creator' : 'joined'} · ${c.debug}`;
  // input level: shows whether your mic or instrument is reaching the app
  const pk = audio.stats.inPeak || 0, db = pk > 0 ? 20 * Math.log10(pk) : -Infinity, pct = d => Math.max(0, Math.min(100, (d + 60) / 60 * 100));
  const hold = showConnection.hold || { db: -Infinity, t: 0 }, now = Date.now();
  if(db >= hold.db || now - hold.t > 1500){ hold.db = db; hold.t = now; } showConnection.hold = hold;   // peak hold for 1.5 s
  $('#inLevel').style.width = (100 - pct(db)) + '%'; $('#inHold').style.left = 'calc(' + pct(hold.db) + '% - 2px)';
  $('#micBtn').style.setProperty('--lvl', Math.max(0, Math.min(1, (db + 50) / 50)).toFixed(2));   // the mic button glows with your level
  $('#inMeter').setAttribute('aria-valuenow', isFinite(db) ? Math.round(db) : -60);
  $('#inDb').textContent = isFinite(hold.db) && hold.db > -60 ? (hold.db >= -0.1 ? 'CLIP' : Math.round(hold.db) + ' dB') : '– dB';
  $('#inDb').classList.toggle('hot', hold.db > -6);
  showConnection.n = (showConnection.n || 0) + 1;
  if(showConnection.n % 8 === 1) checkSetup(c);   // every 2 s
  // the light in the top bar: how the connection to the others is doing
  const worst = c.players.length ? Math.max(...c.players.map(p => p.totalMs)) : null;
  const jewel = $('#connJewel');
  jewel.className = worst === null ? '' : c.lossPct > 3 || worst > 120 ? 'bad' : c.lossPct > 1 || worst > 60 ? 'warn' : 'ok';
  $('#connDot').title = $('#connDotText').textContent = worst === null ? (room.roomCount() > 1 ? 'Connecting…' : 'On your own') : `${c.lossPct > 3 ? 'Choppy' : worst > 60 ? 'OK' : 'Good'} · ${worst} ms`;
  showHud(c);
  if(!c.live) return;
  $('#connStats').innerHTML = `<span>In the room: ${room.roomCount()}/${room.MAX_ROOM}</span><span>Your input ${audio.inputLatencyMs()} ms · output ${audio.outputLatencyMs()} ms</span><span>Lost ${c.lossPct.toFixed(1)}%</span><span>Dropouts ${audio.stats.under}</span>`;
  // per player: estimated time from their instrument to your ears
  $('#latList').innerHTML = c.players.map(p => `<li><span><b>${p.name.replace(/[<&]/g, '')}</b> → you</span><span>≈ ${p.totalMs} ms <span class="muted">(arrives ${p.arriveMs} after they play, network ${p.netMs}${p.route ? ' ' + ROUTE[p.route] : ''}, buffer ${p.bufferMs})</span></span></li>`).join('');
}

const ROUTE = { direct: 'direct', 'direct-tcp': 'direct (TCP)', relay: 'via relay', 'relay-tcp': 'via relay (TCP)' };
// ---- setup check: plain-language tips for the tightest feel ----
function checkSetup(c){
  const tips = [], out = $('#outDev').selectedOptions[0], inp = $('#inDev').selectedOptions[0];
  const names = [(out && out.textContent) || '', (inp && inp.textContent) || ''].join(' ');
  const relayed = c.players.filter(p => p.route && p.route !== 'direct');
  if(relayed.length) tips.push(['warn', `Your audio with ${relayed.map(p => p.name.replace(/[<&]/g, '')).join(', ')} goes ${relayed.some(p => /tcp/.test(p.route)) ? 'through a relay over TCP, which adds delay and stutters' : 'through a relay server, which adds delay'}. A home network (not work, hotel or phone hotspot) usually connects you directly.`]);
  if(engineFellBack) tips.push(['warn', `Desktop app: using browser audio because the app’s engine had a problem (${engineWhy}).`]);
  if(audio.NATIVE){
    tips.push(['ok', `Desktop app: native audio (input ${audio.inputLatencyMs()} ms, output ${audio.outputLatencyMs()} ms).`]);
    tips.push(['info', 'The band plays through your computer’s default output. Set that to the same headphones or interface.']);
  }
  else if($('#speaker').checked) tips.push(['info', 'Echo cancellation is on: no feedback from your speaker, but sound is less clean. With wired headphones, turn it off for the best sound.']);
  else tips.push(['info', 'Using a loudspeaker without headphones? Turn on Echo cancellation.']);
  if(/bluetooth|airpods|buds|beats|headset \(|hands-free/i.test(names)) tips.push(['warn', 'Bluetooth detected: it adds 100+ ms. Use wired headphones or your interface.']);
  else tips.push(['ok', 'No Bluetooth audio detected.']);
  const sr = audio.inputSampleRate();
  if(sr && sr !== 48000) tips.push(['warn', `Your input runs at ${sr / 1000} kHz. Set your interface to 48 kHz to avoid extra conversion.`]);
  else if(sr) tips.push(['ok', 'Input at 48 kHz.']);
  const far = c.players.filter(p => p.netMs > 30);
  if(far.length) tips.push(['warn', `${far.map(p => p.name).join(', ')} ${far.length > 1 ? 'are' : 'is'} far away on the network (${far.map(p => p.netMs + ' ms').join(', ')}). Tight rhythm works best under ~25 ms.`]);
  const ua = navigator.userAgent;
  if(!audio.IN_APP && (!/Chrome|Edg\//.test(ua) || /Firefox/.test(ua))) tips.push(['info', 'Chrome or Edge give the lowest audio delay.']);
  if(!audio.IN_APP && /Windows/.test(ua)) tips.push(['info', 'Windows browsers add some audio delay; a Mac is tighter.']);
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
// ---- built-in tone: amp + cab + EQ (browser), or your input as it is ----
// Each amp keeps your own settings (EQ, level, chorus, reverb), starting from its defaults.
let toneSets = {};
try{ toneSets = JSON.parse(store.get('ss.toneSets') || '{}') || {}; }catch(e){}
const settingsFor = id => Object.assign(toneDefaults(id), toneSets[id] || {});
let toneEq = settingsFor(store.get('ss.tone') || 'off');
const showKnobs = () => document.querySelectorAll('[data-eq]').forEach(r => { r.value = toneEq[r.dataset.eq]; });
const toneNotes = { off: 'Your input as it arrives, like a DI. Use this for vocals, keys, or a tone from your own amp or pedals.' };
function showTone(id){
  document.querySelectorAll('[data-tone]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.tone === id)));
  $('#eqBox').hidden = id === 'off';
  $('#toneNote').textContent = toneNotes[id] || 'You hear your tone through air.band. Turn off direct monitoring on your interface so you don’t hear the dry signal too.';
}
async function pickTone(id){
  showTone(id); store.set('ss.tone', id);
  toneEq = settingsFor(id); showKnobs();
  if(!media) return;   // applied when you join
  try{ $('#toneNote').textContent = id === 'off' ? $('#toneNote').textContent : 'Loading the amp…'; await audio.setTone(id); audio.setToneEq(toneEq); showTone(id); }
  catch(e){ $('#toneNote').textContent = 'Couldn’t load that tone: ' + (e.message || e); }
}
if(audio.canTone()){
  TONES.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.tone = t.id; b.title = toneIcons.SPRITES[t.id].name; b.onclick = () => pickTone(t.id);
    const icon = document.createElement('span'); icon.className = 'tone-icon'; icon.setAttribute('aria-hidden', 'true');
    icon.style.setProperty('--on', `url(${toneIcons.frame(t.id, true)})`); icon.style.setProperty('--off', `url(${toneIcons.frame(t.id, false)})`);
    const label = document.createElement('span'); label.textContent = t.label;
    b.append(icon, label); $('#toneBox').appendChild(b); });
  const saveKnobs = () => { const id = store.get('ss.tone') || 'off'; toneSets[id] = toneEq; store.set('ss.toneSets', JSON.stringify(toneSets)); };
  document.querySelectorAll('[data-eq]').forEach(r => { r.oninput = () => { toneEq[r.dataset.eq] = +r.value; audio.setToneEq(toneEq); saveKnobs(); }; });
  $('#toneReset').onclick = () => { const id = store.get('ss.tone') || 'off'; delete toneSets[id]; store.set('ss.toneSets', JSON.stringify(toneSets)); toneEq = settingsFor(id); showKnobs(); audio.setToneEq(toneEq); };
  showKnobs();
  showTone(TONES.some(t => t.id === store.get('ss.tone')) ? store.get('ss.tone') : 'off');
} else $('#toneSection').hidden = true;   // the desktop app: coming soon
const showChannels = chans => { $('#inCh').disabled = chans < 2; };
$('#inDev').onchange = () => audio.useInput($('#inDev').value, $('#speaker').checked).then(ch => { store.set('ss.inDev', $('#inDev').value); showChannels(ch); return fillDevices(); }).catch(e => ui.status('Couldn’t switch input: ' + (e.name || e)));
$('#inCh').onchange = () => { store.set('ss.inCh', $('#inCh').value); showChannels(audio.setInputChannel($('#inCh').value)); };
// A short beep through whichever engine is playing: the quickest way to check you can hear the app
$('#testSound').onclick = () => {
  const n = Math.round(0.35 * audio.RATE / audio.FRAMES), t0 = clk() + 80;
  for(let b = 0; b < n; b++){
    const pl = new Float32Array(audio.FRAMES);
    for(let i = 0; i < pl.length; i++){ const k = b * audio.FRAMES + i, env = Math.min(1, k / 480, (n * audio.FRAMES - k) / 2400); pl[i] = 0.3 * env * Math.sin(2 * Math.PI * 660 * k / audio.RATE); }
    audio.deliver('test-sound', [pl], t0 + b * audio.BLOCK_MS);
  }
};
if(audio.IN_APP){
  $('#engine').hidden = $('#engineLabel').hidden = false;
  $('#engine').value = store.get('ss.engine') === 'web' ? 'web' : 'native';
  $('#engine').onchange = () => { store.set('ss.engine', $('#engine').value); location.reload(); };
}
$('#outDev').onchange = () => { store.set('ss.outDev', $('#outDev').value); audio.useOutput($('#outDev').value); };
// Echo cancellation: on by default for phones (often used on loudspeaker), off for computers.
if(audio.NATIVE) $('#speaker').closest('label').hidden = true;   // no browser echo cancellation in the app
$('#speaker').checked = store.get('ss.speaker') !== null ? store.get('ss.speaker') === '1' : audio.isPhone();
$('#speaker').onchange = () => { store.set('ss.speaker', $('#speaker').checked ? '1' : '0'); if(media) audio.useInput($('#inDev').value, $('#speaker').checked).then(showChannels).catch(e => ui.status('Couldn’t switch the microphone: ' + (e.name || e))); checkSetup(room.connectionStats()); };
$('#studio').checked = store.get('ss.studio') === '1'; room.format.bits = $('#studio').checked ? 32 : 16;
$('#studio').onchange = () => { room.format.bits = $('#studio').checked ? 32 : 16; store.set('ss.studio', $('#studio').checked ? '1' : '0'); };
if(store.get('ss.inCh')) $('#inCh').value = store.get('ss.inCh');

// ---- controls ----
// The desktop app loads this site, so only its native audio engine can be out of date.
const APP_VERSION = '0.5.0';
const older = (a, b) => { const x = String(a).split('.').map(Number), y = b.split('.').map(Number); for(let i = 0; i < 3; i++){ if((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
const dl = () => /Mac/.test(navigator.userAgent) ? `/download/air.band-${APP_VERSION}-Mac.zip` : `/download/air.band-${APP_VERSION}-Windows-setup.exe`;
if(audio.IN_APP && older(window.__SS_NATIVE.version, APP_VERSION)) $('#appNote').innerHTML = `A new version of the app is available. <a href="https://air.band${dl()}">Download it</a> and reinstall.`;
if(!audio.IN_APP && !audio.isPhone()) $('#appNote').innerHTML = `For the lowest delay, get the desktop app: <a href="/download/air.band-${APP_VERSION}-Mac.zip">Mac</a> · <a href="/download/air.band-${APP_VERSION}-Windows-setup.exe">Windows</a><br>Play through your DAW with the air.band Send plugin (works with the app): <a href="/download/airband-send-${APP_VERSION}-Mac.zip">Mac AU/VST3</a> · <a href="/download/airband-send-${APP_VERSION}-Windows.zip">Windows VST3</a>`;
if(audio.IN_APP){ $('#inviteField').hidden = false; $('#roomLine').textContent = 'Native low-latency audio. Paste an invite link to join a jam, or leave it empty to start one.'; }
if(joinId) $('#roomLine').textContent = 'You’ve been invited to a jam. Add your name and join.';
// A ready-made name for first-timers (keep it or roll another), like Discord or Reddit.
const ADJ = ['Gentle','Soapy','Funky','Velvet','Cosmic','Sleepy','Brassy','Mellow','Rusty','Groovy','Lucky','Salty','Dusty','Electric','Golden','Midnight','Smooth','Wild','Humble','Fuzzy','Swinging','Bouncy','Quiet','Loud','Crispy','Neon','Lazy','Brave','Silver','Sunny'];
const NOUN = ['Warrior','Bird','Otter','Groove','Drummer','Fox','Comet','Walrus','Tiger','Busker','Llama','Echo','Pickle','Rhino','Falcon','Mango','Owl','Riff','Panda','Heron','Koala','Crow','Moth','Badger','Pigeon','Lynx','Whale','Beetle','Toucan','Yeti'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const randomName = () => pick(ADJ) + ' ' + pick(NOUN);
$('#nameInput').value = store.get('ss.name') || randomName();
$('#nameDice').onclick = () => { $('#nameInput').value = randomName(); store.set('ss.name', $('#nameInput').value); };
$('#nameInput').addEventListener('input', () => store.set('ss.name', $('#nameInput').value));
$('#nameInput').addEventListener('keydown', e => { if(e.key === 'Enter') join(); });
$('#joinBtn').onclick = join;
// What you play, picked on the start screen: you land on that part's spot and its AI player steps out.
// Lead ('none'): you solo over the whole band, no part of your own.
let part = ['guitar', 'bass', 'keys', 'drums', 'none'].includes(store.get('ss.part')) ? store.get('ss.part') : 'guitar', seated = false;
const showPart = () => document.querySelectorAll('[data-part]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.part === part)));
document.querySelectorAll('[data-part]').forEach(b => b.onclick = () => { part = b.dataset.part; store.set('ss.part', part); showPart(); });
showPart();
// Once you're in and someone runs the band: take your part (or the first one nobody's playing).
function autoSeat(){
  if(seated || part === 'none' || !S.hostId || $('#roomView').hidden) return;
  seated = true;
  if(S.seats.some(s => session.holders(s).includes(me.name))) return;
  if(S.seats.some(s => s.id === part)) session.toggleSeat(part);   // someone else on it already (two guitarists)? you both are
}
// Your player, picked on the start screen like an arcade game: one of four characters, or your camera.
let look = store.get('ss.look') ?? (store.get('ss.avatar') === '0' ? 'cam' : '0');
if(look !== 'cam') look = String(avatar.charOf(+look));
const lookBtns = [...avatar.CHARS.map((c, i) => [String(i), c.name]), ['cam', 'Camera']].map(([id, name]) => {
  const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.look = id; b.setAttribute('aria-label', name);
  b.innerHTML = '<canvas></canvas><span></span>'; b.querySelector('span').textContent = name;
  b.onclick = () => { look = id; store.set('ss.look', id); lookBtns.forEach(x => x.setAttribute('aria-checked', String(x === b))); };
  b.setAttribute('aria-checked', String(id === look)); $('#lookPick').appendChild(b); return b;
});
let lookFrame = 0;
const lookTimer = setInterval(() => {
  if($('#joinView').hidden) return clearInterval(lookTimer);
  lookFrame++;
  lookBtns.forEach((b, i) => { const on = b.dataset.look === look, cv = b.querySelector('canvas');
    if(b.dataset.look === 'cam') avatar.cameraIcon(cv, on && lookFrame % 4 < 2);
    else avatar.portrait(cv, i, on && lookFrame % 2 === 1, (lookFrame + i) % 4 < 2); });   // the picked one strums, the others bob
}, 250);
// The game, picked when you start a room: BARS (trade N bars each; the default) or Free jam.
const gameLabel = g => g === 'free' ? 'Free jam' : `BARS ${g}`;
let gamePick = ['free', '4', '8', '16', '32'].includes(store.get('ss.game')) ? store.get('ss.game') : '8';
function showPick(){
  document.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.pick === gamePick)));
  $('#pickNote').textContent = gamePick === 'free' ? 'Everyone plays at once. Best when you’re all fairly close.' : `Take turns of ${gamePick} bars, anywhere in the world. Alone? You trade with the AI band.`;
}
document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { gamePick = b.dataset.pick; store.set('ss.game', gamePick); showPick(); });
showPick();
const invited = params.get('g');
$('#inviteInput').addEventListener('input', () => { $('#gamePick').hidden = !!$('#inviteInput').value.trim(); });
if(joinId){ $('#gamePick').hidden = true; if(invited) $('#roomLine').textContent = `You’ve been invited to a ${gameLabel(invited)} jam. Add your name and join.`; }
$('#claimBtn').onclick = async () => { if(!await session.claimBand()) $('#claimStatus').textContent = S.hostName + ' is already running the band.'; };
async function generate(){
  const prompt = $('#prompt').value.trim();
  if(!prompt){ $('#genStatus').textContent = 'Describe the jam first, for example “slow funk in E minor”.'; return; }
  const stemsMode = session.mode === 'prompt';
  $('#genBtn').disabled = true;
  $('#genStatus').textContent = stemsMode ? 'Making your track and splitting it into parts (about 15 seconds)…' : 'Writing the arrangement…';
  const r = await session.generate(prompt, { code: $('#stemsCode').value.trim() || store.get('ss.stemsCode') || '' });
  if(r && r.error === 'code'){ $('#codeRow').hidden = false; $('#genStatus').textContent = 'Enter the access code to make tracks while we’re testing.'; }
  else { if($('#stemsCode').value.trim()) store.set('ss.stemsCode', $('#stemsCode').value.trim()); $('#genStatus').textContent = typeof r === 'string' ? r : (r.error || r.note); }
  $('#genBtn').disabled = false;
}
// Where the band comes from: stock tracks, a prompt made into parts, or Google's live band.
const MODE_NOTES = {
  stock: 'Ready-made tracks, each split into parts. Taking a seat mutes that part completely.',
  prompt: 'Describe any track. It’s made and split into parts in about 15 seconds.',
  live: 'Google’s live AI band: endless and steerable. Taking drums or bass tells it to play less of that part.',
};
function showMode(m){
  session.setMode(m); store.set('ss.mode', m);
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  $('#modeNote').textContent = MODE_NOTES[m] || '';
  $('#stockList').hidden = m !== 'stock'; $('#promptBox').hidden = m === 'stock';
  $('#genBtn').textContent = m === 'prompt' ? 'Make it with parts' : 'Start the live band';
  $('#codeRow').hidden = true;   // prompt -> stems is open to anyone for now
}
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => showMode(b.dataset.mode));
if(session.mode === 'tone') $('#hostControls .modes').hidden = true;   // tests / built-in band only
else showMode(['stock', 'prompt', 'live'].includes(store.get('ss.mode')) ? store.get('ss.mode') : 'stock');
Promise.all(session.STOCK.map(id => fetch(`/packs/${id}/pack.json`).then(r => r.json()).catch(() => null))).then(list => list.filter(Boolean).forEach(meta => {
  const b = document.createElement('button'); b.type = 'button'; b.id = 'stock-' + meta.id; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<b></b><span></span>`; b.querySelector('b').textContent = meta.title; b.querySelector('span').textContent = `${meta.key} · ${meta.bpm} bpm`;
  b.onclick = async () => {
    document.querySelectorAll('#stockList button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#genStatus').textContent = 'Loading ' + meta.title + '…';
    try{ $('#genStatus').textContent = await session.chooseStock(meta.id); }catch(e){ $('#genStatus').textContent = 'Couldn’t load that track.'; }
  };
  $('#stockList').appendChild(b);
}));
$('#genBtn').onclick = generate;
// The game: everyone at once (free jam) or trading N bars each.
$('#keepAI').onchange = () => { if(me.isHost) session.setGame({ ai: $('#keepAI').checked }); };
document.querySelectorAll('[data-game]').forEach(b => b.onclick = () => { if(!me.isHost) return; const g = b.dataset.game; session.setGame(g === 'free' ? { mode:'free' } : { mode:'trade', bars:+g }); });
$('#playBtn').onclick = () => S.playing ? session.stopBand() : session.startBand($('#countIn').checked);
$('#clickAll').onchange = () => { band.options.click = $('#clickAll').checked; };
$('#bpm').addEventListener('change', () => session.setTempo(clamp(Math.round(+$('#bpm').value || S.arr.bpm), 50, 200)));
// Latency first, always: the smallest buffer that stays glitch-free to the ear.
// Laptops get the tight setting; phones (jumpier audio timing) a little more room.
const feel = audio.isPhone() ? 'balanced' : 'tight', BUFFER_LIMIT = audio.isPhone() ? 12 : 8;   // limit in 128-frame blocks
const copy = async (btn, text, done) => { try{ await navigator.clipboard.writeText(inviteLink); const t = btn.textContent; btn.textContent = done; setTimeout(() => btn.textContent = t, 2000); }catch(e){ prompt('Copy this invite link', inviteLink); } };
$('#inviteBtn').onclick = () => copy($('#inviteBtn'), inviteLink, 'Link copied');
$('#leaveBtn').onclick = () => { room.leave(); location.href = location.pathname; };
$('#micBtn').onclick = () => { const on = !audio.micEnabled(); audio.setMicEnabled(on); avatar.setMuted(!on); $('#micBtn').setAttribute('aria-pressed', String(on)); $('#micBtn').title = on ? 'Mic on' : 'Mic off'; };
$('#camBtn').onclick = () => { const v = media && media.getVideoTracks()[0]; if(!v) return; v.enabled = !v.enabled; $('#camBtn').textContent = v.enabled ? 'Camera on' : 'Camera off'; $('#camBtn').setAttribute('aria-pressed', String(v.enabled)); };
// Avatar instead of camera: your camera is switched off for everyone while it's on.
function setAvatar(on){
  avatar.setMine(on, avatar.charOf(+look)); store.set('ss.look', on ? String(avatar.charOf(+look)) : 'cam');
  const v = media && media.getVideoTracks()[0]; if(v) v.enabled = !on && $('#camBtn').getAttribute('aria-pressed') !== 'false';
  const who = on ? avatar.CHARS[avatar.charOf(+look)].name : 'Camera';
  $('#avatarBtn').setAttribute('aria-pressed', String(on)); $('#avatarBtn').setAttribute('aria-label', who); $('#avatarBtn').title = on ? who + ' (tap for your camera)' : 'Camera (tap to be your character)'; $('#camBtn').disabled = on;
  if(on) avatar.portrait($('#avatarBtn canvas'), avatar.charOf(+look), false, false);
}
$('#avatarBtn').onclick = () => setAvatar(!avatar.isOn());
// The pocket synth: pads on screen instead of your instrument (your mic goes quiet while it's on).
let micBeforeSynth = true;
function setSynth(on){
  const ports = audio.synthPorts(); if(on && !ports) return;
  if(on){ micBeforeSynth = audio.micEnabled(); audio.setMicEnabled(false); synth.start($('#synthPanel'), ports.ctx, ports.toRoom, ports.toEars); if(ports.ctx.state !== 'running') ports.ctx.resume(); }
  else { synth.stop(); audio.setMicEnabled(micBeforeSynth); }
  $('#synthBtn').setAttribute('aria-pressed', String(on)); $('#synthBtn').title = on ? 'Synth on' : 'Play a synth on screen';
  const mic = audio.micEnabled(); $('#micBtn').disabled = on; $('#micBtn').setAttribute('aria-pressed', String(mic)); $('#micBtn').title = on ? 'Mic off while the synth is on' : mic ? 'Mic on' : 'Mic off';
  store.set('ss.synth', on ? '1' : '0');
}
$('#synthBtn').onclick = () => setSynth(!synth.isOn());
$('#setBtn').onclick = () => layout.current() ? layout.show(null) : layout.show(layout.last() || 'band');
// Test your delay: clicks out of the speaker, timed by the mic.
$('#synthTest').onclick = async () => {
  const b = $('#synthTest'), note = $('#synthNote'), go = b;
  b.disabled = true; go.textContent = 'Listening…'; note.hidden = false; note.textContent = 'Stay quiet for a second: your phone is clicking through its speaker and listening with its mic.';
  const mic = audio.micEnabled(); let rt = null;
  try{ rt = await audio.measureRoundTrip(); }catch(e){ console.warn(e); }
  audio.setMicEnabled(mic); b.disabled = false; go.textContent = 'Test my delay';
  synth.setMeasured(rt);
  note.innerHTML = rt == null ? 'Couldn’t hear the clicks. Turn the volume up (and take headphones off), then test again.'
    : `Speaker → mic: <b>${rt} ms</b> round trip, so your speaker is about <b>${Math.round(rt / 2)} ms</b> behind. Touchscreens add about 20–40 ms more. ${rt > 90 ? 'That’s a slow audio path: playing slightly ahead of the beat helps, or use the laptop.' : 'That’s about as quick as phones get.'}`;
};
const bandVol = v => { $('#bandVolDb').textContent = v <= -40 ? '(off)' : '(' + (v > 0 ? '+' : '') + v + ' dB)'; band.options.bandVolumeDb = v; band.applyBandVolume(); };
if(store.get('ss.bandVol') !== null) $('#bandVol').value = store.get('ss.bandVol');
$('#bandVol').oninput = () => { bandVol(+$('#bandVol').value); store.set('ss.bandVol', $('#bandVol').value); };
// Boost what you send (too quiet for the others? turn this up, or your interface's gain).
const inGain = db => { $('#inGainDb').textContent = db ? '(+' + db + ' dB)' : '(off)'; room.setInputGain(Math.pow(10, db / 20)); };
if(store.get('ss.inGain') !== null) $('#inGain').value = store.get('ss.inGain');
$('#inGain').oninput = () => { inGain(+$('#inGain').value); store.set('ss.inGain', $('#inGain').value); };
inGain(+$('#inGain').value);
// Each player's volume in your ears (remembered by name). All the way down mutes them.
function showMix(){
  const box = $('#mixPlayers'), here = new Set();
  room.peers.forEach((p, id) => {
    if(!p.name) return; here.add(id);
    let row = box.querySelector(`[data-mix="${id}"]`);
    if(!row){
      row = document.createElement('label'); row.className = 'slider'; row.dataset.mix = id;
      row.innerHTML = '<span><b></b> <i></i></span><input type="range" min="-30" max="12" step="1">';
      const r = row.querySelector('input'), key = 'ss.gain.' + p.name, set = db => { row.querySelector('i').textContent = db <= -30 ? '(muted)' : '(' + (db > 0 ? '+' : '') + db + ' dB)'; room.gains.set(id, db <= -30 ? 0 : Math.pow(10, db / 20)); };
      r.value = store.get(key) ?? 0; r.setAttribute('aria-label', p.name + ' volume');
      r.oninput = () => { set(+r.value); store.set(key, r.value); }; set(+r.value);
      box.appendChild(row);
    }
    row.querySelector('b').textContent = p.name;
  });
  box.querySelectorAll('[data-mix]').forEach(r => { if(!here.has(r.dataset.mix)){ room.gains.delete(r.dataset.mix); r.remove(); } });
}
bandVol(+$('#bandVol').value);
// ---- record: just you, the whole jam, or the jam with video; plus the timing check ----
let recTimer = null, recUrls = [];
const signed = ms => (ms > 0 ? '+' : ms < 0 ? '−' : '±') + Math.abs(Math.round(ms)) + ' ms';
const timing = ms => ms == null ? 'no claps found' : Math.abs(ms) < 5 ? 'on the beat' : ms > 0 ? 'behind the beat' : 'ahead of the beat';
const clock = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
if(store.get('ss.recWhat')) $('#recWhat').value = store.get('ss.recWhat');
$('#recWhat').onchange = () => store.set('ss.recWhat', $('#recWhat').value);
async function toggleRecording(){
  const btn = $('#recBtn');
  if(!recTimer){
    btn.disabled = true;
    try{ await recording.start($('#recWhat').value); }catch(e){ btn.disabled = false; $('#recStatus').textContent = 'Recording needs working audio on this device.'; return; }
    btn.disabled = false; $('#recWhat').disabled = true;
    btn.setAttribute('aria-pressed', 'true');  $('#recStatus').textContent = '0:00';
    recTimer = setInterval(() => { const t = recording.seconds(); $('#recStatus').textContent = clock(t); if(t >= recording.MAX_SECONDS) toggleRecording(); }, 250);
    return;
  }
  clearInterval(recTimer); recTimer = null; btn.disabled = true; $('#recStatus').textContent = 'Finishing…';
  try{
    const r = await recording.stop();
    recUrls.forEach(u => URL.revokeObjectURL(u)); recUrls = [r.take.url, r.timingUrl];
    const el = document.createElement(r.take.video ? 'video' : 'audio'); el.controls = true; el.src = r.take.url; if(r.take.video) el.playsInline = true;
    $('#recMedia').replaceChildren(el);
    $('#recDownload').href = r.take.url; $('#recDownload').download = 'soundstudio-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + r.take.ext;
    $('#recDownload').textContent = r.take.video ? 'Download video' : 'Download audio';
    $('#recTiming').href = r.timingUrl; $('#recResult').hidden = false;
    const q = r.report, notes = [];
    const row = (who, ms) => `<div class="stat"><span>${who}</span><span><b>${ms == null ? '—' : signed(ms)}</b> <span class="muted">${timing(ms)}</span></span></div>`;
    if(q.micSilent) notes.push('Your input recorded almost nothing. Check the input under Audio devices, and on a Mac set Control Centre → Mic Mode to Standard.');
    $('#recReport').innerHTML =
      (q.gap != null ? `<div class="stat"><span>Same clap: your mic → theirs → your ears</span><span><b>${Math.round(q.gap)} ms</b> <span class="muted">${q.pairs} claps</span></span></div>` : '')
      + (r.beats >= 4 && (q.you != null || q.them != null) ? row('You', q.you) + row('Others, as you heard them', q.them) : '')
      + (notes.length ? `<p class="muted small">${notes.join(' ')}</p>` : '');
    $('#recStatus').textContent = clock(r.seconds) + ' recorded';
    $('#recEmpty').hidden = true; layout.show('record');   // the take, ready to play and download
  }catch(e){ $('#recStatus').textContent = 'Recording failed: ' + (e.message || e); }
  btn.disabled = false; $('#recWhat').disabled = false; btn.setAttribute('aria-pressed', 'false'); 
}
$('#recBtn').onclick = toggleRecording;
// The latency counter: always on screen, like a game's FPS counter. One line per
// player (their instrument to your ears), coloured, with the last few seconds as a
// tiny graph; plus your own device's delay. On/off in Connection.
const hudHist = new Map(), BARS8 = '▁▂▃▄▅▆▇█', tone = ms => ms < 30 ? 'ok' : ms < 60 ? 'warn' : 'bad';
$('#hudOn').checked = store.get('ss.hud') !== '0';
$('#hudOn').onchange = () => { store.set('ss.hud', $('#hudOn').checked ? '1' : '0'); $('#hud').hidden = !$('#hudOn').checked; };
function showHud(c){
  const hud = $('#hud'); hud.hidden = !$('#hudOn').checked; if(hud.hidden) return;
  const row = (name, ms, extra) => `<div class="hud-row ${tone(ms)}"><span class="hud-name">${name.replace(/[<&]/g, '')}</span><b>${ms}</b><span class="hud-unit">ms</span>${extra || ''}</div>`;
  const lines = c.players.map(p => {
    const h = hudHist.get(p.name) || []; h.push(p.totalMs); if(h.length > 10) h.shift(); hudHist.set(p.name, h);
    const spark = h.map(v => BARS8[Math.max(0, Math.min(7, Math.round(v / 120 * 7)))]).join('');
    return row(p.name, p.totalMs, `<span class="hud-spark">${spark}</span>${p.route && p.route !== 'direct' ? '<span class="hud-spark hud-note">relay</span>' : ''}`);
  });
  const mine = audio.inputLatencyMs() + audio.outputLatencyMs();
  lines.push(row('You', mine, `<span class="hud-spark hud-note">in ${audio.inputLatencyMs()} · out ${audio.outputLatencyMs()}</span>`));
  hud.innerHTML = lines.join('');
}
// testing at home: make the other devices sound as if they were across the world
$('#farApart').checked = store.get('ss.far') === '1'; room.setFakeDelay($('#farApart').checked ? 150 : 0);
$('#farApart').onchange = () => { store.set('ss.far', $('#farApart').checked ? '1' : '0'); room.setFakeDelay($('#farApart').checked ? 150 : 0); };

['Slow funk in E minor, 96 bpm','12-bar blues shuffle in A','Lo-fi hip hop for a rainy night','Reggae one drop in G','Up-tempo jazz ii-V-I in Bb','Driving indie rock in D'].forEach(t => {
  const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.onclick = () => { $('#prompt').value = t; generate(); }; $('#examples').appendChild(b);
});

// for automated tests
window.getInvite = () => inviteLink;
window.jamEngine = band.engine;
Object.defineProperty(window, 'jamStats', { get: () => audio.stats });
window.jamEchoCancelling = () => audio.echoCancelling();
window.jamLyria = lyria;
window.jamStems = stems;
window.jamTrade = trade;
window.jamTone = id => pickTone(id);
window.jamSynth = synth;
window.jamAudioCtx = () => audio.context();
window.jamRoundTrip = (n, fake) => audio.measureRoundTrip(n, fake);
window.jamSynthOut = () => synth.outNode();
window.jamLevel = id => room.levelNow(id);
window.jamState = S;
window.jamRecord = toggleRecording;
