// Optional: turns a prompt into an arrangement with Claude.
// If ANTHROPIC_API_KEY isn't set, the app falls back to its built-in interpreter.
const STYLES = ['funk','rock','blues','lofi','jazz','pop','reggae','hiphop'];
const BASS = ['root8','sustained','syncopated','walking','onedrop','off'];
const KEYS = ['pad','stabs','comp','bubble','off'];
const GTR = ['power','strum','scratch','skank','arp','fourbeat','off'];

function buildPrompt(request) {
  return `You turn a musician's request into a backing-track arrangement for a live jam session. Reply with JSON only, no prose, no code fences, in exactly this shape:
{"title": string (2 to 5 words), "style": one of ${JSON.stringify(STYLES)}, "bpm": integer 60-180, "key": string like "E minor", "swing": boolean, "chords": [{"name": string, "bars": 1 or 2 or 4}], "bass": one of ${JSON.stringify(BASS)}, "keys": one of ${JSON.stringify(KEYS)}, "guitar": one of ${JSON.stringify(GTR)}, "notes": string (one short sentence about the feel, for the players)}
Rules: the chords form a loop of 4 to 16 bars total that cycles back to the start cleanly. Chord names are a root letter A-G, an optional # or b, then one of: "", m, 7, maj7, m7, m7b5, dim, dim7, sus2, sus4, 7sus4, 6, m6, 9, m9, maj9, add9, 5; optionally a slash bass like "C/E". Choose the style closest to the request, respect any key or tempo given, and use "off" for parts that don't suit the style.
Request: ${request}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: 'No Anthropic key set' });
  const prompt = String((req.body && req.body.prompt) || '').slice(0, 500);
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: buildPrompt(prompt) }]
      })
    });
    const data = await r.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    res.status(200).json(JSON.parse(clean));
  } catch (e) {
    res.status(502).json({ error: 'Arrangement failed' });
  }
}
