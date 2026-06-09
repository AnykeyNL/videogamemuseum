#!/usr/bin/env bash
#
# Update script for an existing install (see install.sh).
#
# Pulls the latest code with `git pull`, re-syncs build-your-own-game/ into the
# /opt install directory, and restarts the systemd service. NGINX / TLS are left
# untouched (use install.sh for the initial setup or to change the domain/cert).
#
# Usage:
#   sudo ./update.sh
#
set -euo pipefail

# --- locate ourselves -------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT_DIR}/build-your-own-game"
CONFIG_FILE="${ROOT_DIR}/deploy.config"

SERVICE_NAME="build-your-own-game"
INSTALL_DIR="/opt/${SERVICE_NAME}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- pre-flight checks ------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Please run as root (sudo ./update.sh)."
[ -f "${APP_DIR}/server.mjs" ] || die "Cannot find ${APP_DIR}/server.mjs."
[ -d "${ROOT_DIR}/.git" ] || die "${ROOT_DIR} is not a git checkout; nothing to pull."
command -v git >/dev/null 2>&1 || die "git is not installed."
[ -d "$INSTALL_DIR" ] || die "${INSTALL_DIR} not found. Run sudo ./install.sh first."

# SERVICE_USER comes from deploy.config when present, otherwise default to the
# same dedicated user install.sh creates.
SERVICE_USER="museumapp"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  SERVICE_USER="${SERVICE_USER:-museumapp}"
fi
id "$SERVICE_USER" >/dev/null 2>&1 || die "Service user '${SERVICE_USER}' does not exist. Run sudo ./install.sh first."

# --- pull latest code -------------------------------------------------------
log "Pulling latest code in ${ROOT_DIR}"
# git refuses to operate on a repo owned by another user (we're root); allow it.
git config --global --add safe.directory "$ROOT_DIR" 2>/dev/null || true
BEFORE="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo none)"
git -C "$ROOT_DIR" pull --ff-only
AFTER="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo none)"
if [ "$BEFORE" = "$AFTER" ]; then
  log "Already up to date (${AFTER}). Re-syncing and restarting anyway."
else
  log "Updated ${BEFORE} -> ${AFTER}"
fi

# --- re-sync the app into /opt ----------------------------------------------
log "Syncing app into ${INSTALL_DIR}"
command -v rsync >/dev/null 2>&1 || { apt-get update -y && apt-get install -y rsync; }
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  "${APP_DIR}/" "${INSTALL_DIR}/"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# --- restart the service ----------------------------------------------------
log "Restarting service: ${SERVICE_NAME}"
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl is-active --quiet "$SERVICE_NAME" \
  || die "Service ${SERVICE_NAME} failed to start. Check: journalctl -u ${SERVICE_NAME} -n 50"

log "Done!"
echo "  App dir : ${INSTALL_DIR}  (synced from ${APP_DIR})"
echo "  Service : systemctl status ${SERVICE_NAME}"
echo "  Logs    : journalctl -u ${SERVICE_NAME} -f"
