#!/bin/bash
# One-time (and re-runnable) setup for a fresh Ubuntu 24.04 VM.
# Run as root from the repo's soundstudio/hub folder on the VM:
#   HUB_DOMAIN=hub.example.com LE_EMAIL=you@example.com ./deploy/setup-vm.sh
# Prerequisite: an A record for $HUB_DOMAIN pointing at this VM.
set -euo pipefail
: "${HUB_DOMAIN:?set HUB_DOMAIN}"
: "${LE_EMAIL:?set LE_EMAIL (for certificate expiry notices)}"
HUB_PORT="${HUB_PORT:-4464}"
UDP_BASE_PORT="${UDP_BASE_PORT:-61002}"
MAX_CLIENTS="${MAX_CLIENTS:-100}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update
apt-get install -y ca-certificates curl ufw certbot
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# Firewall: SSH, ACME HTTP challenge, hub TCP (legacy handshake + WebRTC
# signalling), hub UDP (WebTransport/QUIC), and one UDP port per WebRTC client.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow "${HUB_PORT}/tcp"
ufw allow "${HUB_PORT}/udp"
ufw allow "${UDP_BASE_PORT}:$((UDP_BASE_PORT + MAX_CLIENTS - 1))/udp"
ufw --force enable

# TLS certificate (browsers refuse self-signed). The deploy hook copies it where
# the container (uid 10001) can read it and restarts the hub on every renewal.
install -d -m 0755 "$HERE/certs"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/soundstudio-hub.sh <<HOOK
#!/bin/sh
install -m 0644 /etc/letsencrypt/live/$HUB_DOMAIN/fullchain.pem "$HERE/certs/fullchain.pem"
install -m 0640 -g 10001 /etc/letsencrypt/live/$HUB_DOMAIN/privkey.pem "$HERE/certs/privkey.pem"
cd "$HERE" && docker compose restart hub >/dev/null 2>&1 || true
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/soundstudio-hub.sh
certbot certonly --standalone --non-interactive --agree-tos -m "$LE_EMAIL" -d "$HUB_DOMAIN" \
  --deploy-hook /etc/letsencrypt/renewal-hooks/deploy/soundstudio-hub.sh

if [[ ! -f "$HERE/.env" ]]; then
  cp "$HERE/.env.example" "$HERE/.env"
  sed -i "s|^HUB_SECRET=.*|HUB_SECRET=$(openssl rand -hex 32)|; s|^HUB_DOMAIN=.*|HUB_DOMAIN=$HUB_DOMAIN|" "$HERE/.env"
  chmod 600 "$HERE/.env"
  echo "Created $HERE/.env. Copy its HUB_SECRET into Vercel's HUB_SECRET env var."
fi

cd "$HERE" && docker compose up -d --build
sleep 5
curl -fsS "https://$HUB_DOMAIN:$HUB_PORT/ping" && echo " <- hub is up"
