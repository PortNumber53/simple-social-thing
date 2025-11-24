#!/usr/bin/env bash
set -euo pipefail

# jenkins-deploy-amd64.sh
# Used by Jenkins Deploy stage. Expects these env vars:
#   TARGET_HOST, TARGET_DIR, SERVICE_NAME
# Assumes artifacts/simple-social-thing-linux-amd64 exists in workspace.

TARGET_HOST="${TARGET_HOST:-web1}"
TARGET_DIR="${TARGET_DIR:-/var/www/vhosts/simple.truvis.co}"
SERVICE_NAME="${SERVICE_NAME:-simple-social-thing}"

BIN_LOCAL="artifacts/simple-social-thing-linux-amd64"

if [[ ! -f "$BIN_LOCAL" ]]; then
  echo "ERROR: Binary not found at $BIN_LOCAL"
  exit 1
fi

echo "Deploying $BIN_LOCAL to ${TARGET_HOST}:${TARGET_DIR} (service: ${SERVICE_NAME})"

# Upload binary, config sample, and unit file to /tmp on target
scp "$BIN_LOCAL" "grimlock@${TARGET_HOST}:/tmp/simple-social-thing"
scp deploy/config.ini.sample "grimlock@${TARGET_HOST}:/tmp/config.ini.sample"

cat > simple-social-thing.service <<EOF
[Unit]
Description=Simple Social Thing
After=network-online.target

[Service]
User=grimlock
Group=grimlock
WorkingDirectory=${TARGET_DIR}
EnvironmentFile=/etc/simple-social-thing/config.ini
Environment=PORT=18002
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

scp simple-social-thing.service "grimlock@${TARGET_HOST}:/tmp/simple-social-thing.service"

# Prepare target and (re)start service
ssh "grimlock@${TARGET_HOST}" bash -s <<EOF
set -euo pipefail

# Create application directories
sudo mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/logs"
sudo chown -R grimlock:grimlock "${TARGET_DIR}"

# Setup config directory and file
sudo mkdir -p /etc/simple-social-thing

# Only copy sample config if config.ini doesn't exist
if [ ! -f /etc/simple-social-thing/config.ini ]; then
  echo 'Config file does not exist, creating from sample...'
  sudo cp /tmp/config.ini.sample /etc/simple-social-thing/config.ini
  sudo chown root:grimlock /etc/simple-social-thing/config.ini
  sudo chmod 640 /etc/simple-social-thing/config.ini
  echo 'WARNING: Please edit /etc/simple-social-thing/config.ini with your actual values!'
else
  echo 'Config file already exists, skipping...'
fi

# Clean up temp config sample
rm -f /tmp/config.ini.sample

# Install binary
sudo mv /tmp/simple-social-thing "${TARGET_DIR}/simple-social-thing"
sudo chown grimlock:grimlock "${TARGET_DIR}/simple-social-thing"
sudo chmod 0755 "${TARGET_DIR}/simple-social-thing"

# Install and restart service
sudo mv /tmp/simple-social-thing.service "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"
EOF

echo "Deploy complete."


