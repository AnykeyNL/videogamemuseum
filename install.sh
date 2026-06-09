#!/usr/bin/env bash
#
# Install script for Ubuntu 24.04.
#
# Installs NGINX, installs Node.js, runs build-your-own-game/server.mjs as a
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
APP_DIR="${ROOT_DIR}/build-your-own-game"
CONFIG_FILE="${ROOT_DIR}/deploy.config"

SERVICE_NAME="build-your-own-game"
INSTALL_DIR="/opt/${SERVICE_NAME}"
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
APP_PORT="${APP_PORT:-3848}"
INCLUDE_WWW="${INCLUDE_WWW:-false}"

# The app is copied to /opt (world-traversable) and run as a dedicated, locked
# down system user. Running from a home directory would fail because system
# users can't traverse into /home/<user> (systemd "CHDIR Permission denied").
SERVICE_USER="${SERVICE_USER:-museumapp}"

[ "$DOMAIN" != "example.com" ] || die "Set a real DOMAIN in deploy.config (not example.com)."

export DEBIAN_FRONTEND=noninteractive

# --- packages ---------------------------------------------------------------
log "Updating apt and installing base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx rsync

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
log "Running service as user: ${SERVICE_USER}"

# --- copy the app into /opt -------------------------------------------------
log "Installing app into ${INSTALL_DIR}"
install -d -m 0755 "$INSTALL_DIR"
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  "${APP_DIR}/" "${INSTALL_DIR}/"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# --- systemd service --------------------------------------------------------
log "Writing systemd service: ${SERVICE_NAME}"
{
  echo "[Unit]"
  echo "Description=Build Your Own Game (C64 museum kiosk)"
  echo "After=network.target"
  echo
  echo "[Service]"
  echo "Type=simple"
  echo "User=${SERVICE_USER}"
  echo "WorkingDirectory=${INSTALL_DIR}"
  echo "ExecStart=${NODE_BIN} ${INSTALL_DIR}/server.mjs"
  echo "Environment=PORT=${APP_PORT}"
  echo "Environment=LISTEN_HOST=127.0.0.1"
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

# --- open the host firewall for HTTP/HTTPS ----------------------------------
# Note: this only opens the *host* firewall. On cloud VMs you ALSO need to allow
# inbound TCP 80 and 443 in the provider's firewall (e.g. Oracle Cloud Security
# List / Network Security Group), or Let's Encrypt cannot reach this server.
log "Opening host firewall for ports 80 and 443"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi
if command -v iptables >/dev/null 2>&1; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save || true
  elif [ -d /etc/iptables ]; then
    iptables-save > /etc/iptables/rules.v4 || true
  fi
fi

# --- TLS via Let's Encrypt --------------------------------------------------
log "Installing certbot and requesting a certificate"
apt-get install -y certbot python3-certbot-nginx

CERTBOT_DOMAINS=(-d "$DOMAIN")
[ "$INCLUDE_WWW" = "true" ] && CERTBOT_DOMAINS+=(-d "www.${DOMAIN}")

set +e
certbot --nginx \
  "${CERTBOT_DOMAINS[@]}" \
  --non-interactive --agree-tos \
  -m "$LETSENCRYPT_EMAIL" \
  --redirect
CERTBOT_RC=$?
set -e

if [ "$CERTBOT_RC" -ne 0 ]; then
  printf '\n\033[1;31m==> Certbot could not obtain a certificate yet.\033[0m\n'
  echo "The app is running over HTTP, but HTTPS is not set up. The usual cause is"
  echo "that ports 80/443 are not reachable from the internet."
  echo
  echo "Check, then re-run sudo ./install.sh:"
  echo "  1. Cloud firewall: allow inbound TCP 80 and 443."
  echo "     (Oracle Cloud: VCN -> Security Lists -> add ingress 0.0.0.0/0 tcp 80 and 443.)"
  echo "  2. DNS: ${DOMAIN} must resolve to THIS server's public IP."
  echo "  3. Test from another network: curl -I http://${DOMAIN}/"
  echo
  echo "Site (HTTP for now): http://${DOMAIN}/"
  exit 1
fi

nginx -t
systemctl reload nginx

log "Done!"
echo "  App dir : ${INSTALL_DIR}  (copied from ${APP_DIR})"
echo "  Service : systemctl status ${SERVICE_NAME}"
echo "  Logs    : journalctl -u ${SERVICE_NAME} -f"
echo "  Site    : https://${DOMAIN}/"
echo "  Renewal : certbot auto-renews via its systemd timer (certbot renew --dry-run to test)."
echo "  Update  : re-run sudo ./install.sh to re-sync the app into ${INSTALL_DIR}."
