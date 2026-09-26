import { randomBytes } from 'node:crypto';
import { signHubName } from './_hubname.js';

// Issues the signed name a player uses to join a room on the audio hub.
// GET /api/hub-token?room=jam-ab12c[&pid=abcd1234][&role=p|b]
// pid is optional: a host reuses theirs for the band connection (role b), so
// the hub keeps the band out of the host's own mix.
export default function handler(req, res) {
  const secret = process.env.HUB_SECRET;
  if (!secret) return res.status(500).json({ error: 'HUB_SECRET is not set on the server' });
  const room = String(req.query.room || '').slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!room) return res.status(400).json({ error: 'Missing room' });
  const pid = /^[a-z0-9]{8}$/.test(req.query.pid || '') ? req.query.pid
    : randomBytes(8).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(8, '0').slice(0, 8);
  const role = req.query.role === 'b' ? 'b' : 'p';
  const exp = Math.floor(Date.now() / 1000) + 4 * 3600;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ name: signHubName(secret, room, pid, role, exp), pid, hub: process.env.HUB_HOST || '' });
}
