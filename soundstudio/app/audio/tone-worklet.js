// Runs on the audio thread: your instrument through a neural amp model (NAM),
// mono in, mono out, no added delay. The page sends the engine binary once
// ({ wasm }), then a model whenever you pick a tone ({ model: json | null }).
// With no model loaded the sound passes straight through.
import createNamModule from '../../vendor/nam/nam.js';

// The audio thread has no URL; the engine only uses it to name its .wasm file,
// which we hand over directly.
if(typeof URL === 'undefined') globalThis.URL = class { constructor(path, base){ this.href = String(base || '').replace(/[^/]*$/, '') + path; } toString(){ return this.href; } };

class ToneProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.m = null; this.id = -1; this.inPtr = 0; this.outPtr = 0; this.on = false; this.pending = null;
    this.port.onmessage = e => {
      const d = e.data;
      if(d.wasm) new Promise(res => res(createNamModule({ wasmBinary: d.wasm }))).then(m => {
        this.m = m; m._nam_setSampleRate(sampleRate); m._nam_setMaxBufferSize(128);
        this.id = m._nam_createInstance(); this.inPtr = m._malloc(512); this.outPtr = m._malloc(512);
        if(this.pending !== null) this.load(this.pending);
        this.port.postMessage({ ready: true });
      }).catch(err => this.port.postMessage({ error: String(err) }));
      else if('model' in d){ if(this.m) this.load(d.model); else this.pending = d.model; }
    };
  }
  load(json){
    const m = this.m; this.pending = null; this.on = false;
    if(json === null){ m._nam_unloadModel(this.id); this.port.postMessage({ loaded: null }); return; }
    const n = m.lengthBytesUTF8(json) + 1, p = m._malloc(n);
    m.stringToUTF8(json, p, n);
    const ok = m._nam_loadModel(this.id, p); m._free(p);
    if(ok) m._nam_reset(this.id);
    this.on = !!ok; this.port.postMessage({ loaded: !!ok });
  }
  process(inputs, outputs){
    const inp = inputs[0], out = outputs[0][0];
    if(!inp || !inp.length){ out.fill(0); return true; }
    const n = out.length, a = inp[0], b = inp[1];
    if(!this.on){ for(let i = 0; i < n; i++) out[i] = b ? (a[i] + b[i]) / 2 : a[i]; return true; }
    const heap = this.m.HEAPF32, i0 = this.inPtr >> 2, o0 = this.outPtr >> 2;
    for(let i = 0; i < n; i++) heap[i0 + i] = b ? (a[i] + b[i]) / 2 : a[i];
    this.m._nam_process(this.id, this.inPtr, this.outPtr, n);
    out.set(this.m.HEAPF32.subarray(o0, o0 + n));   // re-read HEAPF32: memory can grow
    return true;
  }
}
registerProcessor('nam-tone', ToneProcessor);
