// Your audio: in a browser, Web Audio (web-io.js); inside the desktop app, the
// app's native low-latency engine (native-io.js). Same exports either way, and
// the desktop app loads this same website, so both always run the same code.
// In the app, useWeb() swaps to the browser engine (a backup if native audio
// can't start or stays silent); the exports below are live, so everyone who
// imported `* as audio` follows the swap.
const saved = (() => { try{ return localStorage.getItem('ss.engine'); }catch(e){ return null; } })();
export const IN_APP = !!window.__SS_NATIVE;
let m = await import(IN_APP && saved !== 'web' ? './native-io.js' : './web-io.js');
export let NATIVE, RATE, FRAMES, BLOCK_MS, micOptions, isPhone, stats, context, start, startRecording, stopRecording, recordedSeconds,
  deliver, forget, setFeel, setBufferLimit, connectMic, setInputChannel, useInput, currentInputId, setMicEnabled, micEnabled,
  canChooseOutput, useOutput, listDevices, inputLatencyMs, inputSampleRate, echoCancelling, outputLatencyMs,
  canTone, setTone, setToneEq, canPlugin, pluginLive, installPlugin, canSynth, synthPorts, measureRoundTrip, alive,
  direct, canDirect, directInfo, directPeer, directGone, setDirectPlay, setDirectGain, setDirectBits;
function bind(x){
  ({ NATIVE, RATE, FRAMES, BLOCK_MS, micOptions, isPhone, stats, context, start, startRecording, stopRecording, recordedSeconds,
    deliver, forget, setFeel, setBufferLimit, connectMic, setInputChannel, useInput, currentInputId, setMicEnabled, micEnabled,
    canChooseOutput, useOutput, listDevices, inputLatencyMs, inputSampleRate, echoCancelling, outputLatencyMs,
    canTone, setTone, setToneEq, canPlugin, pluginLive, installPlugin, canSynth, synthPorts, measureRoundTrip,
    direct, canDirect, directInfo, directPeer, directGone, setDirectPlay, setDirectGain, setDirectBits } = x);
  alive = x.alive || (async () => '');
}
bind(m);
export async function useWeb(){
  if(m.stop) m.stop();
  m = await import('./web-io.js'); bind(m);
}
