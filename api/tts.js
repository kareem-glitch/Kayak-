// A thin ElevenLabs proxy, so a public page can use a voice without the key
// being in the page.
//
// The reader will happily call ElevenLabs directly with a key you paste into
// Settings — that key stays in your own browser, which is fine for your own
// machine. It is not fine for a URL you send to someone: anything in the page
// is theirs too. Set ELEVENLABS_API_KEY on the deployment instead and the key
// never leaves the server.
//
// Vercel serves this at /api/tts. The reader probes it on load and uses it
// automatically when it answers.

const API = 'https://api.elevenlabs.io/v1';

export default async function handler(req, res) {
  const key = process.env.ELEVENLABS_API_KEY;

  // The reader asks "are you there?" before offering the keyless option.
  if (req.method === 'GET' && req.query?.ping) {
    res.status(200).json({ ok: !!key, configured: !!key });
    return;
  }

  if (!key) {
    res.status(501).json({
      detail: 'This deployment has no ELEVENLABS_API_KEY set. Add one in the Vercel project settings, or paste a key into the app’s own settings.',
    });
    return;
  }

  try {
    if (req.method === 'GET' && req.query?.voices) {
      const upstream = await fetch(`${API}/voices`, { headers: { 'xi-api-key': key } });
      const body = await upstream.text();
      res.status(upstream.status).setHeader('content-type', 'application/json').send(body);
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ detail: 'Use POST to synthesise, or GET ?voices=1.' });
      return;
    }

    const { voice_id: voiceId, text, model_id: modelId, language_code: language, voice_settings: settings } = req.body || {};
    if (!voiceId || !text) {
      res.status(400).json({ detail: 'Both voice_id and text are required.' });
      return;
    }

    const payload = { text, model_id: modelId || 'eleven_multilingual_v2' };
    if (settings) payload.voice_settings = settings;
    if (language) payload.language_code = language;

    const upstream = await fetch(
      `${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      res.status(upstream.status).setHeader('content-type', 'application/json').send(detail);
      return;
    }

    const audio = Buffer.from(await upstream.arrayBuffer());
    res.status(200)
      .setHeader('content-type', 'audio/mpeg')
      .setHeader('cache-control', 'public, max-age=31536000, immutable')
      .send(audio);
  } catch (err) {
    res.status(502).json({ detail: `Could not reach ElevenLabs: ${err.message}` });
  }
}
