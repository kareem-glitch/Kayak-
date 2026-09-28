// Built-in tones: amp (neural amp model) -> speaker cabinet -> bass/mid/treble
// -> level, between your input and everything else, so the room hears your
// tone and so do you (monitoring through the app). Browser only for now.
//   Off (DI): your input exactly as it arrives.
export const TONES = [
  { id: 'off', label: 'Off (DI)' },
  { id: 'clean', label: 'Clean', cab: 'guitar-cab', trim: -19.9 },
  { id: 'warm', label: 'Warm', cab: 'guitar-cab', trim: -23.5 },
  { id: 'crunch', label: 'Crunch', cab: 'guitar-cab', trim: -28.5 },
  { id: 'lead', label: 'Lead', cab: 'guitar-cab', trim: -14.5 },
  { id: 'bass', label: 'Bass', cab: 'bass-cab', trim: -16.9 },
];
const LEVEL_DB = 6;   // trims bring every tone to about -18 dB RMS; this sits it a little hotter
const dbToGain = db => Math.pow(10, db / 20);

// Builds the chain once. input/output are AudioNodes; set(id) switches tone.
export async function createToneChain(ctx){
  await ctx.audioWorklet.addModule(new URL('./tone-worklet.js', import.meta.url));
  const amp = new AudioWorkletNode(ctx, 'nam-tone', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const cab = ctx.createConvolver(); cab.normalize = false;
  const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 120;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 750; mid.Q.value = 0.7;
  const treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 3200;
  const level = ctx.createGain();
  amp.connect(cab).connect(bass).connect(mid).connect(treble).connect(level);
  const cabs = {}, models = {};
  let ready = null, current = 'off', eq = { bass: 0, mid: 0, treble: 0, level: 0 };
  const engine = () => ready || (ready = new Promise(async (res, rej) => {
    amp.port.onmessage = e => { if(e.data.ready) res(); if(e.data.error) rej(new Error(e.data.error)); };
    amp.port.postMessage({ wasm: await (await fetch(new URL('../../vendor/nam/nam.wasm', import.meta.url))).arrayBuffer() });
  }));
  const fetchCab = async name => cabs[name] || (cabs[name] = ctx.decodeAudioData(await (await fetch(new URL(`../../tones/${name}.wav`, import.meta.url))).arrayBuffer()));
  const fetchModel = async id => models[id] || (models[id] = (await fetch(new URL(`../../tones/${id}.nam`, import.meta.url))).text());
  function applyEq(){
    const t = TONES.find(x => x.id === current);
    bass.gain.value = eq.bass; mid.gain.value = eq.mid; treble.gain.value = eq.treble;
    level.gain.value = t && t.trim !== undefined ? dbToGain(t.trim + LEVEL_DB + eq.level) : 1;
  }
  return {
    input: amp, output: level,
    get current(){ return current; },
    // Switch tone; resolves once the new amp is loaded and playing.
    async set(id){
      const t = TONES.find(x => x.id === id) || TONES[0];
      current = t.id;
      if(t.id === 'off'){ amp.port.postMessage({ model: null }); applyEq(); return; }
      const [json, ir] = await Promise.all([fetchModel(t.id), fetchCab(t.cab), engine()]);
      if(current !== t.id) return;   // picked something else meanwhile
      const loaded = new Promise(res => { const prev = amp.port.onmessage; amp.port.onmessage = e => { if('loaded' in e.data){ amp.port.onmessage = prev; res(e.data.loaded); } }; });
      amp.port.postMessage({ model: json });
      if(!await loaded) throw new Error('Couldn’t load that tone');
      cab.buffer = await fetchCab(t.cab);
      applyEq();
    },
    setEq(next){ eq = Object.assign(eq, next); applyEq(); },
  };
}
