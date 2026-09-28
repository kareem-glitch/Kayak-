// Your side of the audio: a 48 kHz AudioContext with the jam worklet, the
// instrument/mic input (device + channel), the output device, and the mix of
// what the other players send. Packets are handled by net/room.js; this module
// only deals in 128-frame blocks of Float32 samples.
export const NATIVE = false;
import { createToneChain } from './tone.js';
export const RATE = 48000, FRAMES = 128, BLOCK_MS = FRAMES / RATE * 1000;
// Headphones (default): no processing at all, your instrument exactly as it is.
// Echo cancellation on (loudspeaker, no headphones): the browser's echo cancellation
// and noise handling stop the speaker feeding back into the mic, at some cost to quality.
export const micOptions = speaker => ({ echoCancellation:speaker, noiseSuppression:speaker, autoGainControl:speaker, channelCount:speaker ? 1 : { ideal:2 } });
export const isPhone = () => matchMedia('(pointer:coarse)').matches;

let ctx = null, node = null, micGain = null, micStream = null, micNodes = [], inputChannel = '1';
export const stats = { under: 0, players: {} };   // players: id -> { bufferMs, rate, under, late (far-apart mode) }
let onBlock = () => {};   // called with each captured block: [mono] or [left, right]

export const context = () => ctx;
export async function start(stream, blockHandler){
  onBlock = blockHandler;
  // Computers: ask for the smallest audio buffer the browser allows. Phones keep
  // the default, which is less prone to glitches on slower hardware.
  ctx = new AudioContext({ sampleRate:RATE, latencyHint: isPhone() ? 'interactive' : 0 });
  await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
  node = new AudioWorkletNode(ctx, 'jam-io', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2] });
  node.connect(ctx.destination);
  micGain = ctx.createGain(); micGain.channelCountMode = 'explicit'; micGain.connect(node, 0, 0);
  if(stream.getAudioTracks().length) connectMic(new MediaStream(stream.getAudioTracks()));
  node.port.onmessage = e => {
    const d = e.data;
    if(d.under !== undefined){ stats.under = d.under; stats.players = d.players; stats.inPeak = d.peak; }
    else if(d.recChunk){ if(rec) rec.chunks.push(d.recChunk); }
    else if(d.recDone){ if(rec && rec.done) rec.done(finishRec()); }
    else if(d.b) onBlock(d.b, captureEpoch(d.f));
  };
  await ctx.resume();
}

// ---- recording: what you play and what you hear, sample-exact on one clock ----
let rec = null;
export function startRecording(){ if(!node) throw new Error('audio not started'); rec = { chunks: [], done: null }; node.port.postMessage({ rec: true }); }
export function stopRecording(){ return new Promise(res => { rec.done = res; node.port.postMessage({ rec: false }); }); }
export const recordedSeconds = () => rec ? rec.chunks.reduce((a, c) => a + c.out.length, 0) / RATE : 0;
function finishRec(){
  const len = rec.chunks.reduce((a, c) => a + c.out.length, 0), mic = new Float32Array(len), out = new Float32Array(len);
  let o = 0; for(const c of rec.chunks){ mic.set(c.mic, o); out.set(c.out, o); o += c.out.length; }
  const frame0 = rec.chunks.length ? rec.chunks[0].frame : 0; rec = null;
  return { mic, out, sampleRate: RATE, heardAt: frameToEpoch(frame0) };
}
// Wall-clock ms at which the block at `frame` was captured (processed by the
// audio thread): when it would leave the speakers, minus the output delay.
const captureEpoch = frame => frameToEpoch(frame) - outputLatencyMs();
// Wall-clock ms at which the audio rendered at `frame` leaves your speakers.
function frameToEpoch(frame){
  const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
  if(ts && ts.performanceTime > 0) return performance.timeOrigin + ts.performanceTime + (frame / RATE - ts.contextTime) * 1000;
  return performance.timeOrigin + performance.now() + (frame / RATE - ctx.currentTime) * 1000 + outputLatencyMs();
}

// The audio frame that leaves your speakers at wall-clock ms t (inverse of frameToEpoch).
function epochToFrame(t){
  const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
  if(ts && ts.performanceTime > 0) return (ts.contextTime + (t - performance.timeOrigin - ts.performanceTime) / 1000) * RATE;
  return (ctx.currentTime + (t - performance.timeOrigin - performance.now() - outputLatencyMs()) / 1000) * RATE;
}
// Audio from another player: one block of planes ([mono] or [mono, L, R]).
// at (far-apart mode): wall-clock ms it should leave your speakers; otherwise as soon as it can.
export function deliver(id, planes, at){ if(!node) return; if(at == null) node.port.postMessage({ id, planes }); else node.port.postMessage({ id, planes, at: epochToFrame(at) }); }
export function forget(id){ node && node.port.postMessage({ gone:id }); }
// Upper limit for each player's adaptive buffer, in 128-frame blocks.
// Feel: 'tight' | 'balanced' | 'smooth' (see FEELS in worklet.js).
export function setFeel(name){ node && node.port.postMessage({ feel:name }); }
export function setBufferLimit(blocks){ node && node.port.postMessage({ limit:blocks * FRAMES }); }

// Built-in tone (tone.js): your input through an amp, cab and EQ before the room
// hears it, and you hear it too (turn off your interface's direct monitoring).
// 'off' sends your input exactly as it arrives.
let chain = null, monitor = null;
export const canTone = () => true;
// The DAW plugin needs the desktop app.
export const canPlugin = () => false;
export const pluginLive = () => false;
export const installPlugin = async () => { throw new Error('The plugin works with the desktop app.'); };
export async function setTone(id){
  if(!ctx) throw new Error('audio not started');
  if(id !== 'off' && !chain){ chain = await createToneChain(ctx); monitor = ctx.createGain(); monitor.connect(ctx.destination); }
  if(chain) await chain.set(id);
  micGain.disconnect(); if(chain){ try{ chain.output.disconnect(); }catch(e){} }
  if(id === 'off'){ micGain.connect(node, 0, 0); return; }
  micGain.connect(chain.input); chain.output.connect(node, 0, 0); chain.output.connect(monitor);
}
export const setToneEq = eq => { if(chain) chain.setEq(eq); };

// Input: which channel(s) of the device to send: '1', '2', 'mix' (1+2 as mono)
// or 'stereo' (1 and 2 as left and right). Returns the device's channel count
// so the UI can disable the picker for mono devices.
export function connectMic(stream){
  micNodes.forEach(n => { try{ n.disconnect(); }catch(e){} }); micNodes = [];
  micStream = stream;
  const src = ctx.createMediaStreamSource(stream);
  const chans = (stream.getAudioTracks()[0].getSettings().channelCount) || src.channelCount || 1;
  micGain.channelCount = inputChannel === 'stereo' && chans >= 2 ? 2 : 1;   // the worklet sends as many channels as it receives
  if(inputChannel === 'mix' || inputChannel === 'stereo' || chans < 2){ src.connect(micGain); micNodes = [src]; }
  else { const split = ctx.createChannelSplitter(2); src.connect(split); split.connect(micGain, inputChannel === '2' ? 1 : 0); micNodes = [src, split]; }
  return chans;
}
export function setInputChannel(ch){ inputChannel = ch; return micStream ? connectMic(micStream) : 1; }
export async function useInput(deviceId, speaker){
  const stream = await navigator.mediaDevices.getUserMedia({ audio:Object.assign(micOptions(speaker), deviceId ? { deviceId:{ exact:deviceId } } : {}) });
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
const track = () => micStream && micStream.getAudioTracks()[0];
// How long your input takes to reach the page, as the browser reports it (Chrome
// gives the device latency; elsewhere we fall back to the context's base latency).
export const inputLatencyMs = () => { const l = track() && track().getSettings().latency; return Math.round((l || (ctx ? ctx.baseLatency : 0)) * 1000); };
export const inputSampleRate = () => track() && track().getSettings().sampleRate;
export const echoCancelling = () => !!(track() && track().getSettings().echoCancellation);
export const outputLatencyMs = () => ctx ? Math.round(((ctx.outputLatency || 0) + ctx.baseLatency) * 1000) : 0;
