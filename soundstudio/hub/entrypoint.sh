#!/bin/bash
# Starts the three hub processes and exits (so Docker restarts the container)
# if any of them dies: a headless JACK server, the JackTrip hub, and the
# SoundStudio room patcher that decides who hears whom.
set -euo pipefail

: "${SAMPLE_RATE:=48000}"
: "${BUFFER_SIZE:=128}"
: "${HUB_PORT:=4464}"
: "${UDP_BASE_PORT:=61002}"
: "${CERT_FILE:=/certs/fullchain.pem}"
: "${KEY_FILE:=/certs/privkey.pem}"
: "${ICE_SERVERS:=stun:stun.l.google.com:19302}"
: "${JACKTRIP_EXTRA:=}"

if [[ -z "${HUB_SECRET:-}" ]]; then
  echo "ss-hub: HUB_SECRET is not set; refusing to start (nobody would be patched)" >&2
  exit 1
fi

tls_args=()
if [[ -r "$CERT_FILE" && -r "$KEY_FILE" ]]; then
  tls_args=(--certfile "$CERT_FILE" --keyfile "$KEY_FILE")
else
  echo "ss-hub: no readable TLS cert at $CERT_FILE / $KEY_FILE; browser clients will be refused" >&2
fi

# Realtime scheduling needs CAP_SYS_NICE + an rtprio ulimit (see docker-compose.yml).
jack_rt=(-R)
[[ "${JACK_REALTIME:-1}" == "1" ]] || jack_rt=(-r)
jackd "${jack_rt[@]}" -d dummy -r "$SAMPLE_RATE" -p "$BUFFER_SIZE" &
jack_pid=$!
for _ in $(seq 1 50); do
  jack_lsp >/dev/null 2>&1 && break
  sleep 0.1
done

# -p 5: no automatic patching; the SoundStudio patcher owns all connections.
# -u:   upmix mono players to stereo.
# --bufstrategy 4 -q auto: JackTrip's packet-loss-concealment jitter buffer,
#       which also tolerates clients whose packet size differs from the hub's.
# shellcheck disable=SC2086
jacktrip -S -p 5 -u --bufstrategy 4 -q auto \
  --bindport "$HUB_PORT" --udpbaseport "$UDP_BASE_PORT" \
  --iceservers "$ICE_SERVERS" "${tls_args[@]}" $JACKTRIP_EXTRA &
hub_pid=$!

python3 /usr/local/bin/ss-patcher &
patcher_pid=$!

trap 'kill $patcher_pid $hub_pid $jack_pid 2>/dev/null || true' TERM INT
wait -n
echo "ss-hub: a hub process exited; stopping container" >&2
kill $patcher_pid $hub_pid $jack_pid 2>/dev/null || true
exit 1
