#!/bin/bash
# Sets up a fresh Ubuntu 24.04 server with the whole SoundStudio backend.
# Run automatically by the cloud-config file (see README); safe to re-run.
# Expects /opt/soundstudio/.env to already contain HUB_SECRET and LIVEKIT_KEYS.
set -euxo pipefail
exec > >(tee -a /var/log/soundstudio-setup.log) 2>&1

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV=/opt/soundstudio/.env

# The server's public address, and a free hostname that points at it.
IP="$(curl -fsS -m 5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || curl -fsS -m 10 https://api.ipify.org)"
HOST="${IP//./-}.sslip.io"
sed -i '/^SS_IP=/d;/^SS_HOST=/d' "$ENV"
printf 'SS_IP=%s\nSS_HOST=%s\n' "$IP" "$HOST" >> "$ENV"
chmod 600 "$ENV"

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# Oracle Cloud's Ubuntu images ship iptables rules that reject everything but
# SSH, ahead of anything ufw adds. Clear them so ufw below is the one firewall.
if [[ -f /etc/iptables/rules.v4 ]]; then
  iptables -P INPUT ACCEPT
  iptables -F INPUT
  rm -f /etc/iptables/rules.v4 /etc/iptables/rules.v6
  systemctl disable --now netfilter-persistent 2>/dev/null || true
fi

# Firewall: SSH, HTTPS (+80 for certificates), audio hub, video.
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 4464/tcp
ufw allow 4464/udp
ufw allow 61002:61101/udp
ufw allow 7881/tcp
ufw allow 7882/udp
ufw --force enable

cd "$HERE"
docker compose -f server-compose.yml --env-file "$ENV" up -d --build
echo "SoundStudio server ready at https://$HOST (audio hub on port 4464)"
