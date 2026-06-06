#!/usr/bin/env bash
#
# Install script for Ubuntu 24.04.
#
# Installs NGINX, installs Node.js, runs build-character/server.mjs as a
# systemd service bound to localhost, configures NGINX as a reverse proxy in
# front of it, and obtains a Let's Encrypt SSL certificate for the domain
# defined in ./deploy.config (with HTTP -> HTTPS redirect).
#
# Usage:
#   cp deploy.config.example deploy.config
#   nano deploy.config            # set DOMAIN and LETSENCRYPT_EMAIL
#   sudo ./install.sh
#
set -euo pipefail

# --- locate ourselves -------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT_DIR}/build-character"
CONFIG_FILE="${ROOT_DIR}/deploy.config"

SERVICE_NAME="build-character"
SERVICE_USER="museumapp"
NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}.conf"
NODE_MAJOR=20

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- pre-flight checks ------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Please run as root (sudo ./install.sh)."
[ -f "$CONFIG_FILE" ] || die "Missing ${CONFIG_FILE}. Run: cp deploy.config.example deploy.config  then edit it."
[ -f "${APP_DIR}/server.mjs" ] || die "Cannot find ${APP_DIR}/server.mjs."

# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${DOMAIN:?Set DOMAIN in deploy.config}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL in deploy.config}"
APP_PORT="${APP_PORT:-3847}"
INCLUDE_WWW="${INCLUDE_WWW:-false}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"

[ "$DOMAIN" != "example.com" ] || die "Set a real DOMAIN in deploy.config (not example.com)."

export DEBIAN_FRONTEND=noninteractive

# --- packages ---------------------------------------------------------------
log "Updating apt and installing base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx

# --- Node.js ----------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
else
  log "Node.js already present: $(node -v)"
fi
NODE_BIN="$(command -v node)"

# --- service user -----------------------------------------------------------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creating system user ${SERVICE_USER}"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi
# The app writes generated runs into build-character/output/, so the service
# user needs ownership of the app directory.
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

# --- systemd service --------------------------------------------------------
log "Writing systemd service: ${SERVICE_NAME}"
{
  echo "[Unit]"
  echo "Description=Build Character (C64 museum exhibit)"
  echo "After=network.target"
  echo
  echo "[Service]"
  echo "Type=simple"
  echo "User=${SERVICE_USER}"
  echo "WorkingDirectory=${APP_DIR}"
  echo "ExecStart=${NODE_BIN} ${APP_DIR}/server.mjs"
  echo "Environment=PORT=${APP_PORT}"
  echo "Environment=LISTEN_HOST=127.0.0.1"
  [ -n "$OPENAI_API_KEY" ] && echo "Environment=OPENAI_API_KEY=${OPENAI_API_KEY}"
  [ -n "$GEMINI_API_KEY" ] && echo "Environment=GEMINI_API_KEY=${GEMINI_API_KEY}"
  echo "Restart=on-failure"
  echo "RestartSec=3"
  echo "NoNewPrivileges=true"
  echo "PrivateTmp=true"
  echo
  echo "[Install]"
  echo "WantedBy=multi-user.target"
} > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl is-active --quiet "$SERVICE_NAME" || die "Service ${SERVICE_NAME} failed to start. Check: journalctl -u ${SERVICE_NAME}"

# --- NGINX reverse proxy (HTTP first; certbot adds HTTPS) --------------------
SERVER_NAMES="$DOMAIN"
[ "$INCLUDE_WWW" = "true" ] && SERVER_NAMES="$DOMAIN www.${DOMAIN}"

log "Writing NGINX site for: ${SERVER_NAMES}"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES};

    # Webcam photo uploads can be a few MB.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF

ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"
[ -e /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

# --- TLS via Let's Encrypt --------------------------------------------------
log "Installing certbot and requesting a certificate"
apt-get install -y certbot python3-certbot-nginx

CERTBOT_DOMAINS=(-d "$DOMAIN")
[ "$INCLUDE_WWW" = "true" ] && CERTBOT_DOMAINS+=(-d "www.${DOMAIN}")

certbot --nginx \
  "${CERTBOT_DOMAINS[@]}" \
  --non-interactive --agree-tos \
  -m "$LETSENCRYPT_EMAIL" \
  --redirect

nginx -t
systemctl reload nginx

log "Done!"
echo "  Service : systemctl status ${SERVICE_NAME}"
echo "  Logs    : journalctl -u ${SERVICE_NAME} -f"
echo "  Site    : https://${DOMAIN}/"
echo "  Renewal : certbot auto-renews via its systemd timer (certbot renew --dry-run to test)."
