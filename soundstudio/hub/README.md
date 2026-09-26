# SoundStudio audio hub

The server that mixes everyone's audio. It is the open-source
[JackTrip](https://github.com/jacktrip/jacktrip) hub server (MIT licence), built
with browser support, plus a small SoundStudio "room patcher". Players never
see any of this; they only see the SoundStudio page.

## What runs in the container

| Process | Job |
|---|---|
| `jackd` (dummy driver, 48 kHz, 128 frames) | Audio engine the hub mixes in; no sound card needed |
| `jacktrip -S -p 5 …` | Hub server: accepts browsers (WebRTC data channels on TCP 4464, WebTransport on UDP 4464) and desktop JackTrip clients |
| `ss-patcher` (`patcher/patcher.py`) | Decides who hears whom (see below) |

### Rooms and access control

JackTrip's own password option does not apply to browser connections, and one
hub is one shared mix. So the hub runs with automatic patching off, and the
patcher wires clients together itself:

- Each client connects with a signed name, `<room>.<pid>.<role>.<exp>.<sig>`,
  minted by the web app's API with `HUB_SECRET` (`api/_hubname.js`, mirrored
  in `patcher.py`).
- Clients in the same room hear everyone but themselves (mix-minus). Mono
  players are spread to both channels of the stereo mix.
- The host's band connects as role `b` with the host's pid: everyone hears it
  except the host, who monitors the band locally with no delay.
- A client with a missing, forged or expired name is connected to nothing: it
  hears silence and nobody hears it.

### Patches to JackTrip

`patches/` holds small fixes applied at build time (all found while testing
browser clients against v3.0.1):

1. `0001` WebTransport listener falls back to IPv4 on hosts without IPv6.
2. `0002` Browser sessions that vanish (tab closed, network lost, or never
   finished connecting) are released after ~10 s instead of occupying a hub
   slot forever.
3. `0003` Fixes a memory overflow that crashed the hub when a browser sent
   fewer channels than it received (mono in, stereo mix out) and that also
   truncated the mix to one channel.

These are worth offering upstream to JackTrip.

## Ports (open these in the VM firewall)

| Port | Protocol | Used for |
|---|---|---|
| 4464 | TCP | Browser WebRTC signalling (TLS), `/ping` health check, desktop JackTrip handshake |
| 4464 | UDP | WebTransport (QUIC) |
| 61002 to 61101 | UDP | One port per connected browser (WebRTC) or desktop client; widen for more than 100 players |
| 80 | TCP | Only for Let's Encrypt certificate issuing/renewal |

## Settings

Copy `.env.example` to `.env` on the server (never commit it). `HUB_SECRET`
must match the web app's `HUB_SECRET` on Vercel.

## Test page

`test/hub-test.html` connects one browser tab to a hub, sends a test tone or
your mic, and shows what comes back. Open two tabs with different signed names
in the same room and each should report hearing the other's tone.

## Tested so far (in a local container)

- Two headless Chrome tabs in one room, 440 Hz and 660 Hz tones: each hears
  only the other, stereo, 0 packets lost over 5 rounds of ~8 s.
- A third tab with an unsigned name: hears nothing, is heard by no one.
- Closed tabs are released after ~11 s; no crashes over 15 sessions.
- Not yet tested: WebTransport (this test machine has no IPv6; verify on the
  real server), Safari/Firefox, real networks, and latency.
