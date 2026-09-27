// Your side of the audio: a 48 kHz AudioContext with the jam worklet, the
// instrument/mic input (device + channel), the output device, and the mix of
// what the other players send. Packets are handled by net/room.js; this module
// only deals in 128-frame blocks of Float32 samples.
export const RATE = 48000, FRAMES = 128, BLOCK_MS = FRAMES / RATE * 1000;
export const MIC_OPTS = { echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:{ ideal:2 } };

let ctx = null, node = null, micGain = null, micStream = null, micNodes = [], inputChannel = '1';
export const stats = { under: 0 };
let onBlock = () => {};   // called with each captured mono block

export const context = () => ctx;
export async function start(stream, blockHandler){
  onBlock = blockHandler;
  ctx = new AudioContext({ sampleRate:RATE, latencyHint:'interactive' });
  await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
  node = new AudioWorkletNode(ctx, 'jam-io', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2] });
  node.connect(ctx.destination);
  micGain = ctx.createGain(); micGain.channelCount = 1; micGain.channelCountMode = 'explicit'; micGain.connect(node, 0, 0);
  if(stream.getAudioTracks().length) connectMic(new MediaStream(stream.getAudioTracks()));
  node.port.onmessage = e => { const d = e.data; if(d.under !== undefined) stats.under = d.under; else onBlock(d); };
  await ctx.resume();
}

// Audio from another player: one block of planes ([mono] or [mono, L, R]).
export function deliver(id, planes){ node && node.port.postMessage({ id, planes }); }
export function forget(id){ node && node.port.postMessage({ gone:id }); }
export function setMaxQueue(blocks){ node && node.port.postMessage({ max:blocks }); }

// Input: which channel of the device to send ('1', '2' or 'mix'). Returns the
// device's channel count so the UI can disable the picker for mono devices.
export function connectMic(stream){
  micNodes.forEach(n => { try{ n.disconnect(); }catch(e){} }); micNodes = [];
  micStream = stream;
  const src = ctx.createMediaStreamSource(stream);
  const chans = (stream.getAudioTracks()[0].getSettings().channelCount) || src.channelCount || 1;
  if(inputChannel === 'mix' || chans < 2){ src.connect(micGain); micNodes = [src]; }
  else { const split = ctx.createChannelSplitter(2); src.connect(split); split.connect(micGain, inputChannel === '2' ? 1 : 0); micNodes = [src, split]; }
  return chans;
}
export function setInputChannel(ch){ inputChannel = ch; return micStream ? connectMic(micStream) : 1; }
export async function useInput(deviceId){
  const stream = await navigator.mediaDevices.getUserMedia({ audio:Object.assign({}, MIC_OPTS, deviceId ? { deviceId:{ exact:deviceId } } : {}) });
  const old = micStream, chans = connectMic(stream);
  if(old && old !== stream) old.getAudioTracks().forEach(t => t.stop());
  return chans;
}
export const currentInputId = () => micStream && micStream.getAudioTracks()[0] && micStream.getAudioTracks()[0].getSettings().deviceId;
export function setMicEnabled(on){ if(micGain) micGain.gain.value = on ? 1 : 0; }
export const micEnabled = () => !micGain || micGain.gain.value !== 0;

// Output: switch every AudioContext on the page (ours and Tone.js's; see the
// constructor hook in index.html) so the band and the players move together.
export const canChooseOutput = () => 'setSinkId' in AudioContext.prototype;
export async function useOutput(deviceId){
  const all = [...new Set([ctx, ...(window.__audioContexts || [])].filter(Boolean))];
  await Promise.all(all.map(c => c.setSinkId ? c.setSinkId(deviceId || '').catch(() => {}) : null));
}
export async function listDevices(){
  const devs = await navigator.mediaDevices.enumerateDevices();
  const pick = kind => devs.filter(d => d.kind === kind && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.label || (kind === 'audioinput' ? 'Input ' : 'Output ') + (i + 1) }));
  return { inputs: pick('audioinput'), outputs: pick('audiooutput') };
}
export const outputLatencyMs = () => ctx ? Math.round(((ctx.outputLatency || 0) + ctx.baseLatency) * 1000) : 0;
