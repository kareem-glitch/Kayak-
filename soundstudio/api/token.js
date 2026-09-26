import { AccessToken } from 'livekit-server-sdk';

// Issues a LiveKit access token so a player can join a jam room.
export default async function handler(req, res) {
  const room = String(req.query.room || '').slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '');
  const name = String(req.query.name || '').trim().slice(0, 40);
  if (!room || !name) return res.status(400).json({ error: 'Missing room or name' });
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
    return res.status(500).json({ error: 'LiveKit keys are not set on the server' });
  }
  const identity = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 7);
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, name, ttl: '4h' });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  res.status(200).json({ token: await at.toJwt(), url: process.env.LIVEKIT_URL });
}
