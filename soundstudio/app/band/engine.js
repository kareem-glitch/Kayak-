// The backing band: Tone.js synths driven by the arrangement in S.arr. Every
// device in a room runs its own copy, started on the shared clock (playAt), so
// nobody hears the band through the network. No DOM access: the UI listens via
// hooks.onBeat (chord/beat display) and hooks.onChange (re-render).
import { S, me } from '../state.js';
import * as lyria from './lyria.js';
import { STYLES } from './theory.js';
import { clk } from '../util.js';

export const hooks = { onBeat: () => {}, onChange: () => {} };
export const options = { click: false, bandVolumeDb: 0 };   // local, per-device settings

let E = null, counter = 0, voiceIdx = 0;
function buildEngine(){
  const limiter = new Tone.Limiter(-1).toDestination();
  const master = new Tone.Volume(-3).connect(limiter);
  // Every device runs its own copy of the band, started on a shared clock (see
  // playAt), so nobody hears the band through the network.
  const chan = () => { const ch=new Tone.Channel({volume:0}).connect(master); const meter=new Tone.Meter({smoothing:.75}); ch.connect(meter); return {ch,meter}; };
  const e = { master, drums:chan(), bass:chan(), keys:chan(), guitar:chan() };
  const clickCh = new Tone.Channel({volume:-6}).toDestination(); // count-in/click, heard locally
  e.kick=new Tone.MembraneSynth({pitchDecay:.04,octaves:6,envelope:{attack:.001,decay:.35,sustain:0,release:.1}}).connect(e.drums.ch);
  e.snare=new Tone.NoiseSynth({noise:{type:'white'},envelope:{attack:.001,decay:.16,sustain:0}}).connect(new Tone.Filter(1700,'highpass').connect(e.drums.ch)); e.snare.volume.value=-8;
  e.hat=new Tone.NoiseSynth({noise:{type:'white'},envelope:{attack:.001,decay:.045,sustain:0}}).connect(new Tone.Filter(7500,'highpass').connect(e.drums.ch)); e.hat.volume.value=-16;
  e.ride=new Tone.NoiseSynth({noise:{type:'pink'},envelope:{attack:.001,decay:.3,sustain:0}}).connect(new Tone.Filter(5200,'highpass').connect(e.drums.ch)); e.ride.volume.value=-18;
  e.bassSynth=new Tone.MonoSynth({oscillator:{type:'sawtooth'},filter:{Q:2,type:'lowpass',rolloff:-24},envelope:{attack:.005,decay:.2,sustain:.6,release:.15},filterEnvelope:{attack:.005,decay:.12,sustain:.3,release:.2,baseFrequency:110,octaves:2.4}}).connect(e.bass.ch); e.bassSynth.volume.value=-8;
  e.ep=new Tone.PolySynth(Tone.FMSynth,{harmonicity:3,modulationIndex:8,oscillator:{type:'sine'},modulation:{type:'sine'},envelope:{attack:.004,decay:1.2,sustain:.25,release:.8},modulationEnvelope:{attack:.002,decay:.4,sustain:.1,release:.5}}).connect(e.keys.ch); e.ep.maxPolyphony=32; e.ep.volume.value=-16;
  e.pad=new Tone.PolySynth(Tone.AMSynth,{envelope:{attack:.35,decay:.4,sustain:.8,release:1.4}}).connect(e.keys.ch); e.pad.maxPolyphony=32; e.pad.volume.value=-20;
  e.gDist=new Tone.Distortion(.6); e.gDist.wet.value=0; e.gDist.chain(new Tone.Filter(3400,'lowpass'), e.guitar.ch);
  e.gtr=Array.from({length:8},()=>{ const v=new Tone.PluckSynth({attackNoise:1,dampening:3800,resonance:.93}).connect(e.gDist); v.volume.value=-4; return v; });
  e.click=new Tone.Synth({oscillator:{type:'triangle'},envelope:{attack:.001,decay:.05,sustain:0,release:.02}}).connect(clickCh);
  setTimeout(() => { applyBandVolume(); applyMutes(); });
  return e;
}
const mf = m => Tone.Frequency(m,'midi').toFrequency();
const chordAt = bar => S.arr.chords[S.arr.barMap[((bar%S.arr.barMap.length)+S.arr.barMap.length)%S.arr.barMap.length]];
const hit = (pat,step) => { const c=pat&&pat[step]; return c==='X'?1:c==='x'?.72:c==='o'?.32:0; };
const bassRoot = pc => 28+((pc-4+12)%12);
function keysVoicing(p){ const base=52+((p.root-4+12)%12); return [...new Set(p.ints.map(i=>{ let n=base+i; while(n>76) n-=12; return n; }))].sort((a,b)=>a-b).map(mf); }
function gtrVoicing(p){ const r=40+((p.root-4+12)%12); const third=p.ints.find(i=>i===3||i===4)??(p.ints.includes(2)?2:p.ints.includes(5)?5:4); const fifth=p.ints.includes(6)?6:p.ints.includes(8)?8:7; const sev=p.ints.find(i=>i===9||i===10||i===11); return [r,r+fifth,r+12,r+12+third,sev!==undefined?r+12+sev:r+12+fifth].map(mf); }
function strum(freqs,time,dir=1,gap=.012){ (dir>0?freqs:[...freqs].reverse()).forEach((f,i)=>E.gtr[voiceIdx++%E.gtr.length].triggerAttack(f,time+i*gap)); }

function playDrums(step,time){ const d=STYLES[S.arr.style].drums; let v;
  if((v=hit(d.kick,step))) E.kick.triggerAttackRelease('C1','8n',time,v);
  if((v=hit(d.snare,step))) E.snare.triggerAttackRelease('16n',time,v);
  if((v=hit(d.hat,step))) E.hat.triggerAttackRelease('32n',time,v);
  if((v=hit(d.ride,step))) E.ride.triggerAttackRelease('8n',time,v); }
function playBass(step,time,ch,next){
  const p=ch.parsed, r=bassRoot(p.bass), third=p.ints.includes(3)?3:4, fifth=p.ints.includes(6)?6:7, b7=p.ints.includes(11)?11:10; let pat=null;
  switch(S.arr.bass){
    case 'root8': pat={0:[0,'8n'],2:[0,'8n'],4:[0,'8n'],6:[0,'8n'],8:[0,'8n'],10:[0,'8n'],12:[0,'8n'],14:[12,'8n']}; break;
    case 'sustained': pat={0:[0,'2n'],8:[fifth,'4n.'],14:[12,'16n']}; break;
    case 'syncopated': pat={0:[0,'8n'],3:[12,'16n'],6:[0,'16n'],8:[b7,'16n'],10:[fifth,'8n'],13:[12,'16n'],14:[b7,'16n']}; break;
    case 'onedrop': pat={4:[0,'8n'],6:[0,'16n'],8:[fifth,'8n'],11:[b7,'16n'],12:[0,'8n'],14:[third,'8n']}; break;
    case 'walking':
      if(step===0) pat={0:[0,'4n']}; else if(step===4) pat={4:[third,'4n']}; else if(step===8) pat={8:[fifth,'4n']};
      else if(step===12){ let t=bassRoot(next.parsed.bass); while(t-r>7) t-=12; while(r-t>7) t+=12; pat={12:[t+(Math.random()<.5?-1:1)-r,'4n']}; }
      break;
  }
  if(pat&&pat[step]) E.bassSynth.triggerAttackRelease(mf(r+pat[step][0]),pat[step][1],time,.9);
}
function playKeys(step,time,ch,bar){ const v=keysVoicing(ch.parsed);
  switch(S.arr.keys){
    case 'pad': if(step===0) E.pad.triggerAttackRelease(v,'1m',time,.55); break;
    case 'stabs': if([3,6,10,14].includes(step)) E.ep.triggerAttackRelease(v,'16n',time,step===6?.75:.6); break;
    case 'comp': if(step===0) E.ep.triggerAttackRelease(v,'8n.',time,.6); else if(step===6) E.ep.triggerAttackRelease(v,'8n',time,.5); else if(step===12&&bar%2===1) E.ep.triggerAttackRelease(v,'8n',time,.45); break;
    case 'bubble': if([2,6,10,14].includes(step)) E.ep.triggerAttackRelease(v,'16n',time,step%8===6?.55:.4); break;
  } }
function playGuitar(step,time,ch){ const v=gtrVoicing(ch.parsed);
  switch(S.arr.guitar){
    case 'power': if(step%2===0) strum(v.slice(0,3),time,1,.004); break;
    case 'strum': { const m={0:1,6:-1,8:1,12:1,14:-1}; if(m[step]) strum(v,time,m[step],m[step]>0?.013:.009); break; }
    case 'scratch': if([2,4,7,10,12,14].includes(step)) strum(v.slice(2),time,step%4===0?1:-1,.005); break;
    case 'skank': if(step===4||step===12) strum(v.slice(2),time,-1,.006); break;
    case 'arp': if(step%2===0){ const o=[0,2,3,4,2,3,1,2]; strum([v[o[(step/2)%8]]],time); } break;
    case 'fourbeat': if(step%4===0) strum(v.slice(0,4),time,1,.008); break;
  } }

function tick(time){
  const c=counter++;
  if(c<0){ const s=c+16; if(s%4===0){ E.click.triggerAttackRelease(s===0?'C6':'G5','32n',time); Tone.Draw.schedule(()=>hooks.onBeat({count:s/4+1, beat:s/4}),time); } return; }
  const step=c%16, bar=Math.floor(c/16), ch=chordAt(bar), next=chordAt(bar+1);
  if(options.click && step%4===0) E.click.triggerAttackRelease(step===0?'C6':'G5','32n',time);
  playDrums(step,time); playBass(step,time,ch,next); playKeys(step,time,ch,bar); if(S.arr.guitar!=='off') playGuitar(step,time,ch);
  if(step%4===0){ const idx=S.arr.barMap[bar%S.arr.barMap.length]; Tone.Draw.schedule(()=>hooks.onBeat({chord:idx,beat:step/4}),time); }
}

const dbOrOff = v => v <= -30 ? -Infinity : v;
export const engine = () => E;
export function ensureEngine(){ if(!E) E = buildEngine(); return E; }

// Personal band volume (dB relative to the default mix; -40 = off).
export function applyBandVolume(){ const v = options.bandVolumeDb; if(E) E.master.volume.value = v <= -40 ? -Infinity : -3 + v; lyria.setVolume(v <= -40 ? -Infinity : v); }
// Shared part levels and seats. A taken seat is silenced through its volume
// (setting volume after Channel.mute would undo the mute).
export function applyMutes(){
  // Lyria band: the host tells the music model which parts to leave out
  if(isLyria() && me.isHost){ clearTimeout(applyMutes.t); applyMutes.t = setTimeout(lyria.update, 250); }
  if(!E) return; S.seats.forEach(s=>{ E[s.id].ch.volume.value = s.human ? -Infinity : dbOrOff((S.levels||{})[s.id]||0); }); E.gDist.wet.value = S.arr && S.arr.guitar==='power' ? .65 : 0; }

// Start this device's band at wall-clock time atLocal (ms) with the 16th-note
// counter at startCounter (-16 = one bar of count-in), early by the output
// latency so the sound leaves the speakers on time.
export let started = null;   // { atLocal, startCounter, outLat, zero }: zero = when bar 1 beat 1 would have sounded
export const isLyria = () => !!(S.arr && S.arr.engine === 'lyria');
let beatTimer = null;
export async function playAt(atLocal, startCounter){
  await Tone.start();
  if(isLyria()){   // the stream's first sample is bar 1 beat 1
    if(E){ Tone.Transport.stop(); Tone.Transport.cancel(); }
    lyria.playAt(atLocal);
    started = { atLocal, startCounter: 0, outLat: 0, zero: atLocal }; window.jamStart = started;
    const beatMs = 60000 / S.arr.bpm; let last = -1; clearInterval(beatTimer);
    beatTimer = setInterval(() => { const b = Math.floor((clk() - atLocal) / beatMs); if(b >= 0 && b !== last){ last = b; hooks.onBeat({ beat: b % 4 }); } }, 20);
    S.playing = true; hooks.onChange(); return;
  }
  ensureEngine();
  applyMutes();
  const raw=Tone.getContext().rawContext, outLat=(raw.outputLatency||0)+(raw.baseLatency||0);
  // Ignore a repeat of the start we're already playing (e.g. a retried join).
  const zero0 = atLocal - startCounter * 15000 / S.arr.bpm;
  if(S.playing && started && Math.abs(started.zero - zero0) < 50) return;
  // Stop "now": Tone's default stop time includes its look-ahead, which could land after a soon start.
  Tone.Transport.stop(raw.currentTime); Tone.Transport.cancel(0); Tone.Transport.position=0;
  Tone.Transport.bpm.value=S.arr.bpm; Tone.Transport.swing=S.arr.swing?.3:0; Tone.Transport.swingSubdivision='8n';
  // If this start time has already passed (slow message, late joiner), come in at the next bar.
  const barMs=4*60000/S.arr.bpm;
  while(atLocal < clk()+300){ atLocal += barMs; startCounter += 16; }
  counter=startCounter;
  Tone.Transport.scheduleRepeat(tick,'16n',0);
  const when=raw.currentTime+(atLocal-clk())/1000-outLat;
  Tone.Transport.start(Math.max(raw.currentTime+0.15, when));
  started = { atLocal, startCounter, outLat, zero: atLocal - startCounter * 15000 / S.arr.bpm };
  window.jamStart = started;   // for automated tests
  S.playing=true; hooks.onChange();
}
export function stopLocal(){
  clearInterval(beatTimer); lyria.stopLocal();
  if(!E){ if(S.playing){ S.playing = false; hooks.onChange(); hooks.onBeat({}); } return; }
  Tone.Transport.stop(); Tone.Transport.cancel(); E.pad.releaseAll(); E.ep.releaseAll();
  S.playing=false; hooks.onChange(); hooks.onBeat({});
}
// Current level of one part in dB (for the host's meters).
export const partLevel = id => E ? E[id].meter.getValue() : -Infinity;
