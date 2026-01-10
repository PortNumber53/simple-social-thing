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
#   LOG_LEVEL (optional, defaults to empty) - written into config.ini; enables verbose logging when set to debug/trace
#   PUBLIC_ORIGIN (optional) - written into config.ini; used for scheduled post video URLs
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
LOG_LEVEL="${LOG_LEVEL:-}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"

if [[ -z "${DATABASE_URL}" ]]; then
  echo "ERROR: DATABASE_URL is required (will be written into /etc/simple-social-thing/config.ini)"
  exit 1
fi

BIN_LOCAL="artifacts/simple-social-thing-linux-${GOARCH}"
MIGRATIONS_DIR_LOCAL="backend/db/migrations"

if [[ ! -f "$BIN_LOCAL" ]]; then
  echo "ERROR: Binary not found at $BIN_LOCAL"
  exit 1
fi

if [[ ! -d "${MIGRATIONS_DIR_LOCAL}" ]]; then
  echo "ERROR: Migrations directory not found at ${MIGRATIONS_DIR_LOCAL}"
  exit 1
fi
if ! ls -1 "${MIGRATIONS_DIR_LOCAL}"/*.sql >/dev/null 2>&1; then
  echo "ERROR: No migration .sql files found under ${MIGRATIONS_DIR_LOCAL}"
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

  # Upload binary, migrations, and unit file to /tmp on target
  ssh -p "${SSH_PORT}" "${SSH_USER}@${TARGET_HOST}" "rm -rf /tmp/sst-migrations && mkdir -p /tmp/sst-migrations"
  scp -P "${SSH_PORT}" "$BIN_LOCAL" "${SSH_USER}@${TARGET_HOST}:/tmp/simple-social-thing"
  scp -P "${SSH_PORT}" "${MIGRATIONS_DIR_LOCAL}"/*.sql "${SSH_USER}@${TARGET_HOST}:/tmp/sst-migrations/"
  scp -P "${SSH_PORT}" simple-social-thing.service "${SSH_USER}@${TARGET_HOST}:/tmp/simple-social-thing.service"

  # Prepare target and (re)start service
  ssh -p "${SSH_PORT}" "${SSH_USER}@${TARGET_HOST}" bash -s <<EOF
set -euo pipefail

# Create application directories (avoid failing deploy on chown/user-group mismatches)
sudo mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/logs"
sudo chmod 0755 "${TARGET_DIR}" "${TARGET_DIR}/logs"

# Ensure DB migration files exist next to deployed binary for runtime migrate-on-startup.
sudo mkdir -p "${TARGET_DIR}/db/migrations"
sudo cp -f /tmp/sst-migrations/*.sql "${TARGET_DIR}/db/migrations/"
rm -rf /tmp/sst-migrations

# (Re)generate config on every deploy (from Jenkins secrets)
sudo install -d -m 0755 /etc/simple-social-thing
sudo tee /etc/simple-social-thing/config.ini >/dev/null <<CFG
DATABASE_URL=${DATABASE_URL}
PORT=${APP_PORT}
ENVIRONMENT=${ENVIRONMENT_NAME}
LOG_LEVEL=${LOG_LEVEL}
PUBLIC_ORIGIN=${PUBLIC_ORIGIN}
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
