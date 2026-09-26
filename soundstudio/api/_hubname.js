import { createHash, createHmac } from 'node:crypto';

// Mints the signed name a client gives the audio hub. The hub's patcher
// (hub/patcher/patcher.py) only connects clients whose name verifies, and only
// to others in the same room. Format: <room>.<pid>.<role>.<exp>.<sig>
//   room: first 10 hex chars of sha256(room name)
//   pid:  8 chars [a-z0-9], shared by a host's player and band connections
//   role: "p" player or "b" band
//   exp:  unix seconds, base 36
//   sig:  base64url(HMAC-SHA256(HUB_SECRET, everything before it)), 16 chars
export function hubRoomTag(room) {
  return createHash('sha256').update(room).digest('hex').slice(0, 10);
}

export function signHubName(secret, room, pid, role, exp) {
  const body = `${hubRoomTag(room)}.${pid}.${role}.${exp.toString(36)}`;
  const sig = createHmac('sha256', secret).update(body).digest('base64url').slice(0, 16);
  return `${body}.${sig}`;
}
