// SoundStudio band relay (Cloudflare Worker + Durable Object).
// One BandRoom per jam room holds a single live Lyria RealTime session (Google's
// music model) with the API key kept here, and fans the audio out to everyone
// in the room, so all devices hear the same band.
//
// Client -> relay (JSON text):
//   {t:'play', prompts:[{text, weight}], config:{bpm, scale, muteBass, muteDrums, ...}}
//   {t:'update', prompts?, config?}   (a changed bpm or scale restarts the music context)
//   {t:'stop'}
// Relay -> clients:
//   binary: [0..8) f64 first sample index of this chunk in the stream, [8..12) u32 stream id,
//           then 16-bit little-endian stereo PCM at 48 kHz
//   text:   {t:'status', state:'starting'|'playing'|'stopped'|'error', stream, message?}
const LYRIA = 'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic';
const MODEL = 'models/lyria-realtime-exp';

export default {
  async fetch(req, env){
    const url = new URL(req.url), m = url.pathname.match(/^\/room\/([\w-]{4,80})$/);
    if(url.pathname === '/') return new Response('SoundStudio band relay');
    if(!m) return new Response('Not found', { status: 404 });
    if((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

export class BandRoom {
  constructor(state, env){ this.env = env; this.clients = new Set(); this.up = null; this.stream = 0; this.sample = 0; this.last = null; this.status = 'stopped'; }

  async fetch(req){
    const [client, server] = Object.values(new WebSocketPair());
    server.accept(); this.clients.add(server);
    server.send(JSON.stringify({ t: 'status', state: this.status, stream: this.stream }));
    server.addEventListener('message', e => this.onClient(e.data));
    const gone = () => { this.clients.delete(server); if(!this.clients.size) this.stopUpstream(); };
    server.addEventListener('close', gone); server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg){ for(const c of this.clients){ try{ c.send(msg); }catch(e){ this.clients.delete(c); } } }
  setStatus(state, message){ this.status = state; this.broadcast(JSON.stringify({ t: 'status', state, stream: this.stream, message })); }

  async onClient(data){
    let m; try{ m = JSON.parse(data); }catch(e){ return; }
    if(m.t === 'play') await this.play(m);
    else if(m.t === 'update') this.update(m);
    else if(m.t === 'stop') this.stopUpstream();
  }

  async play(m){
    this.stopUpstream();
    this.stream++; this.sample = 0; this.last = { prompts: m.prompts, config: m.config || {} };
    this.setStatus('starting');
    let resp;
    try{ resp = await fetch(`${LYRIA}?key=${this.env.GEMINI_API_KEY}`, { headers: { Upgrade: 'websocket' } }); }
    catch(e){ return this.setStatus('error', 'Couldn’t reach the music engine'); }
    const up = resp.webSocket; if(!up) return this.setStatus('error', 'The music engine refused the connection');
    up.accept(); this.up = up; const stream = this.stream;
    up.addEventListener('message', e => this.onUpstream(e.data, stream));
    up.addEventListener('close', e => { if(this.up === up){ this.up = null; if(this.status !== 'stopped') this.setStatus(e.code === 1000 ? 'stopped' : 'error', e.reason || 'The music engine closed'); } });
    up.send(JSON.stringify({ setup: { model: MODEL } }));
  }

  update(m){
    if(!this.up || !this.last) return;
    const before = this.last.config || {};
    if(m.prompts){ this.last.prompts = m.prompts; this.up.send(JSON.stringify({ clientContent: { weightedPrompts: m.prompts } })); }
    if(m.config){
      const config = Object.assign({}, before, m.config); this.last.config = config;
      this.up.send(JSON.stringify({ musicGenerationConfig: config }));
      if(config.bpm !== before.bpm || config.scale !== before.scale) this.up.send(JSON.stringify({ playbackControl: 'RESET_CONTEXT' }));
    }
  }

  async onUpstream(data, stream){
    // Google sends its JSON messages as binary frames
    const text = typeof data === 'string' ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : await data.text();
    if(stream !== this.stream) return;
    let m; try{ m = JSON.parse(text); }catch(e){ return; }
    if(m.setupComplete){
      this.up.send(JSON.stringify({ clientContent: { weightedPrompts: this.last.prompts } }));
      this.up.send(JSON.stringify({ musicGenerationConfig: this.last.config }));
      this.up.send(JSON.stringify({ playbackControl: 'PLAY' }));
      return;
    }
    const chunks = m.serverContent && m.serverContent.audioChunks;
    if(chunks) for(const c of chunks){
      const pcm = Uint8Array.from(atob(c.data), ch => ch.charCodeAt(0));
      const out = new Uint8Array(12 + pcm.length), dv = new DataView(out.buffer);
      dv.setFloat64(0, this.sample, true); dv.setUint32(8, this.stream, true); out.set(pcm, 12);
      this.sample += pcm.length / 4;
      if(this.status !== 'playing') this.setStatus('playing');
      this.broadcast(out);
    }
    if(m.filteredPrompt) this.broadcast(JSON.stringify({ t: 'status', state: this.status, stream: this.stream, message: 'Part of the prompt was blocked: ' + (m.filteredPrompt.filteredReason || '') }));
  }

  stopUpstream(){
    if(this.up){ try{ this.up.send(JSON.stringify({ playbackControl: 'STOP' })); this.up.close(1000, 'stopped'); }catch(e){} this.up = null; }
    if(this.status !== 'stopped') this.setStatus('stopped');
  }
}
