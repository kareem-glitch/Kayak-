// Audio thread: passes each render quantum of its input to the page (separate-track recording, tracks.js).
try{
  registerProcessor('rec-tap', class extends AudioWorkletProcessor {
    process(inputs){ const c = inputs[0]; if(c && c[0]) this.port.postMessage([c[0].slice(0), (c[1] || c[0]).slice(0)]); return true; }
  });
}catch(e){}   // already registered in this context
