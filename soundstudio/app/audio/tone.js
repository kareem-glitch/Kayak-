// Built-in tones: drive -> amp (neural amp model) -> speaker cabinet -> the
// amp's voicing -> your bass/mid/treble -> level -> chorus -> reverb, between
// your input and everything else, so the room hears your tone and so do you
// (monitoring through the app). Browser only for now.
//   Off (DI): your input exactly as it arrives.
// Each amp has its own job, not just more gain (measured: see test/e2e/tone.e2e.mjs):
//   Clean  never breaks up; scooped and sparkly, with chorus    (JC-style)
//   Warm   clean until you dig in; round, dark top              (Dumble-style)
//   Crunch cleans up soft, bites when you dig in; 1 kHz mids    (Marshall-style)
//   Lead   a boost into a high-gain amp; saturated, scooped      (5150-style)
//   Bass   bass amp and cab
// trim: level so every amp sits at about the same loudness (measured offline).
export const TONES = [
  { id: 'off', label: 'Off (DI)' },
  { id: 'clean', label: 'Clean', cab: 'guitar-cab', drive: -6, trim: -12.5,
    voice: [['peaking', 500, -5, 0.8], ['highshelf', 3000, 5]], fx: { chorus: 35, reverb: 25 } },
  { id: 'warm', label: 'Warm', cab: 'warm-cab', drive: -8, trim: -21.6,
    voice: [['peaking', 250, 4, 0.7], ['highshelf', 2500, -8]], fx: { chorus: 0, reverb: 30 } },
  { id: 'crunch', label: 'Crunch', cab: 'guitar-cab', drive: -6, trim: -29.3,
    voice: [['highpass', 120, 0, 0.7], ['peaking', 1000, 6, 1.0], ['highshelf', 5000, -2]], fx: { chorus: 0, reverb: 15 } },
  { id: 'lead', label: 'Lead', cab: 'lead-cab', drive: 12, boost: ['lowshelf', 700, -12], trim: -9.4,
    voice: [['peaking', 750, -6, 0.8], ['lowshelf', 100, 4], ['highshelf', 3500, 3]], fx: { chorus: 0, reverb: 25 } },
  { id: 'bass', label: 'Bass', cab: 'bass-cab', drive: 0, trim: -16.9,
    voice: [['lowshelf', 80, 2]], fx: { chorus: 0, reverb: 0 } },
];
export const defaults = id => Object.assign({ bass: 0, mid: 0, treble: 0, level: 0, chorus: 0, reverb: 0 }, (TONES.find(t => t.id === id) || {}).fx);
const LEVEL_DB = 6;   // trims bring every tone to about -18 dB RMS; this sits it a little hotter
const dbToGain = db => Math.pow(10, db / 20);

// A stereo reverb tail made on the spot: decaying noise, a little different on
// each side, darker as it fades (a plate-like room, about 1.8 s).
function reverbImpulse(ctx){
  const len = Math.round(ctx.sampleRate * 2.2), pre = Math.round(ctx.sampleRate * 0.012), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for(let c = 0; c < 2; c++){
    const d = buf.getChannelData(c); let lp = 0, seed = 1 + c * 7919;
    for(let i = pre; i < len; i++){
      seed = (seed * 16807) % 2147483647; const n = seed / 1073741823.5 - 1, t = (i - pre) / ctx.sampleRate;
      const k = 0.55 - 0.45 * Math.min(1, t / 1.5);   // the tail loses its highs as it fades
      lp += k * (n - lp); d[i] = lp * Math.exp(-t * 3.8);
    }
  }
  return buf;
}

// Builds the chain once. input/output are AudioNodes; set(id) switches amp,
// setEq({bass, mid, treble, level, chorus, reverb}) turns the knobs.
export async function createToneChain(ctx){
  await ctx.audioWorklet.addModule(new URL('./tone-worklet.js', import.meta.url));
  const node = (type, ...a) => { const f = ctx.createBiquadFilter(); f.type = type; return f; };
  const drive = ctx.createGain(), boost = node('lowshelf');
  const amp = new AudioWorkletNode(ctx, 'nam-tone', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const cab = ctx.createConvolver(); cab.normalize = false;
  const voice = [node('peaking'), node('peaking'), node('peaking')];
  const bass = node('lowshelf'), mid = node('peaking'), treble = node('highshelf'), level = ctx.createGain(), out = ctx.createGain();
  bass.frequency.value = 120; mid.frequency.value = 750; mid.Q.value = 0.7; treble.frequency.value = 3200;
  drive.connect(boost).connect(amp).connect(cab).connect(voice[0]).connect(voice[1]).connect(voice[2]).connect(bass).connect(mid).connect(treble).connect(level);

  // effects: stereo chorus (two modulated short delays, opposite phase) then reverb.
  // Both at zero: bypassed, and your sound stays mono (half the data to send).
  const fxIn = ctx.createGain(), merge = ctx.createChannelMerger(2), dryL = ctx.createGain(), dryR = ctx.createGain();
  fxIn.connect(dryL).connect(merge, 0, 0); fxIn.connect(dryR).connect(merge, 0, 1);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.8; lfo.start();
  const wet = [];
  [[0.012, 1, 0], [0.017, -1, 1]].forEach(([base, sign, side]) => {
    const d = ctx.createDelay(0.05), depth = ctx.createGain(), w = ctx.createGain();
    d.delayTime.value = base; depth.gain.value = 0.0025 * sign; lfo.connect(depth).connect(d.delayTime);
    fxIn.connect(d).connect(w).connect(merge, 0, side); w.gain.value = 0; wet.push(w);
  });
  const verb = ctx.createConvolver(); verb.buffer = reverbImpulse(ctx);
  const verbSend = ctx.createGain(); verbSend.gain.value = 0;
  merge.connect(out); merge.connect(verbSend).connect(verb).connect(out);
  let fxOn = null;
  function route(on){
    if(on === fxOn) return; fxOn = on;
    try{ level.disconnect(); }catch(e){}
    level.connect(on ? fxIn : out);
  }
  route(false);

  const cabs = {}, models = {};
  let ready = null, current = 'off', eq = defaults('off');
  const engine = () => ready || (ready = new Promise(async (res, rej) => {
    amp.port.onmessage = e => { if(e.data.ready) res(); if(e.data.error) rej(new Error(e.data.error)); };
    amp.port.postMessage({ wasm: await (await fetch(new URL('../../vendor/nam/nam.wasm', import.meta.url))).arrayBuffer() });
  }));
  const fetchCab = async name => cabs[name] || (cabs[name] = ctx.decodeAudioData(await (await fetch(new URL(`../../tones/${name}.wav`, import.meta.url))).arrayBuffer()));
  const fetchModel = async id => models[id] || (models[id] = (await fetch(new URL(`../../tones/${id}.nam`, import.meta.url))).text());
  function voiceFor(t){
    drive.gain.value = dbToGain(t.drive || 0);
    const [bt, bf, bg] = t.boost || ['lowshelf', 700, 0]; boost.type = bt; boost.frequency.value = bf; boost.gain.value = bg;
    voice.forEach((f, i) => { const v = (t.voice || [])[i] || ['peaking', 1000, 0, 1]; f.type = v[0]; f.frequency.value = v[1]; f.gain.value = v[2]; f.Q.value = v[3] || 0.707; });
  }
  function applyEq(){
    const t = TONES.find(x => x.id === current);
    bass.gain.value = eq.bass; mid.gain.value = eq.mid; treble.gain.value = eq.treble;
    level.gain.value = t && t.trim !== undefined ? dbToGain(t.trim + LEVEL_DB + eq.level) : 1;
    const ch = eq.chorus / 100, rv = eq.reverb / 100;
    wet.forEach(w => { w.gain.value = ch * 0.7; });
    dryL.gain.value = dryR.gain.value = 1 - ch * 0.25;
    verbSend.gain.value = rv * rv * 0.9;
    route(ch > 0 || rv > 0);
  }
  return {
    input: drive, output: out,
    get current(){ return current; },
    // Switch amp; resolves once the new amp is loaded and playing.
    async set(id){
      const t = TONES.find(x => x.id === id) || TONES[0];
      current = t.id;
      if(t.id === 'off'){ amp.port.postMessage({ model: null }); applyEq(); return; }
      const [json] = await Promise.all([fetchModel(t.id), fetchCab(t.cab), engine()]);
      if(current !== t.id) return;   // picked something else meanwhile
      const loaded = new Promise(res => { const prev = amp.port.onmessage; amp.port.onmessage = e => { if('loaded' in e.data){ amp.port.onmessage = prev; res(e.data.loaded); } }; });
      amp.port.postMessage({ model: json });
      if(!await loaded) throw new Error('Couldn’t load that tone');
      cab.buffer = await fetchCab(t.cab);
      voiceFor(t); applyEq();
    },
    setEq(next){ eq = Object.assign({}, eq, next); applyEq(); },
    get stereo(){ return !!fxOn; },
  };
}
