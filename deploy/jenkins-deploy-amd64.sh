#!/usr/bin/env bash
set -euo pipefail

# jenkins-deploy-amd64.sh
# Used by Jenkins Deploy stage. Expects these env vars:
#   TARGET_HOSTS (space-separated) OR TARGET_HOST (single), TARGET_DIR, SERVICE_NAME
#   GOARCH (defaults to amd64)
#   SSH_USER (defaults to grimlock), SSH_PORT (defaults to 22)
#   SERVICE_USER / SERVICE_GROUP (defaults to SSH_USER)
#   DATABASE_URL (required) - written into /etc/simple-social-thing/config.ini each deploy
#   APP_PORT (optional, defaults to 18911) - written into config.ini
#   ENVIRONMENT_NAME (optional, defaults to production) - written into config.ini
#
# Assumes artifacts/simple-social-thing-linux-${GOARCH} exists in workspace.

GOARCH="${GOARCH:-amd64}"
TARGET_HOSTS="${TARGET_HOSTS:-${TARGET_HOST:-web1}}"
TARGET_DIR="${TARGET_DIR:-/var/www/vhosts/simple.truvis.co}"
SERVICE_NAME="${SERVICE_NAME:-simple-social-thing}"
SSH_USER="${SSH_USER:-grimlock}"
SSH_PORT="${SSH_PORT:-22}"
SERVICE_USER="${SERVICE_USER:-$SSH_USER}"
SERVICE_GROUP="${SERVICE_GROUP:-$SSH_USER}"
DATABASE_URL="${DATABASE_URL:-}"
APP_PORT="${APP_PORT:-18911}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-production}"

if [[ -z "${DATABASE_URL}" ]]; then
  echo "ERROR: DATABASE_URL is required (will be written into /etc/simple-social-thing/config.ini)"
  exit 1
fi

BIN_LOCAL="artifacts/simple-social-thing-linux-${GOARCH}"

if [[ ! -f "$BIN_LOCAL" ]]; then
  echo "ERROR: Binary not found at $BIN_LOCAL"
  exit 1
fi

IFS=' ' read -r -a HOSTS <<< "${TARGET_HOSTS}"
if [[ ${#HOSTS[@]} -eq 0 ]]; then
  echo "ERROR: No TARGET_HOSTS specified"
  exit 1
fi

cat > simple-social-thing.service <<EOF
[Unit]
Description=Simple Social Thing
After=network-online.target

[Service]
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${TARGET_DIR}
EnvironmentFile=/etc/simple-social-thing/config.ini
ExecStart=${TARGET_DIR}/simple-social-thing
Restart=always
RestartSec=2s
NoNewPrivileges=true
LimitNOFILE=65536
StandardOutput=append:${TARGET_DIR}/logs/app.log
StandardError=append:${TARGET_DIR}/logs/error.log

[Install]
WantedBy=multi-user.target
EOF

for TARGET_HOST in "${HOSTS[@]}"; do
  echo "=== Deploying ${BIN_LOCAL} (${GOARCH}) to ${SSH_USER}@${TARGET_HOST}:${TARGET_DIR} (service: ${SERVICE_NAME}) ==="

  # Upload binary and unit file to /tmp on target
  scp -P "${SSH_PORT}" "$BIN_LOCAL" "${SSH_USER}@${TARGET_HOST}:/tmp/simple-social-thing"
  scp -P "${SSH_PORT}" simple-social-thing.service "${SSH_USER}@${TARGET_HOST}:/tmp/simple-social-thing.service"

  # Prepare target and (re)start service
  ssh -p "${SSH_PORT}" "${SSH_USER}@${TARGET_HOST}" bash -s <<EOF
set -euo pipefail

# Create application directories (avoid failing deploy on chown/user-group mismatches)
sudo mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/logs"
sudo chmod 0755 "${TARGET_DIR}" "${TARGET_DIR}/logs"

# (Re)generate config on every deploy (from Jenkins secrets)
sudo install -d -m 0755 /etc/simple-social-thing
sudo tee /etc/simple-social-thing/config.ini >/dev/null <<CFG
DATABASE_URL=${DATABASE_URL}
PORT=${APP_PORT}
ENVIRONMENT=${ENVIRONMENT_NAME}
CFG
sudo chown root:root /etc/simple-social-thing/config.ini
sudo chmod 0640 /etc/simple-social-thing/config.ini
sudo test -f /etc/simple-social-thing/config.ini

# Install binary
sudo mv /tmp/simple-social-thing "${TARGET_DIR}/simple-social-thing"
sudo chmod 0755 "${TARGET_DIR}/simple-social-thing"

# Install and restart service
sudo mv /tmp/simple-social-thing.service "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"
EOF

  echo "=== Deploy complete: ${TARGET_HOST} ==="
done
