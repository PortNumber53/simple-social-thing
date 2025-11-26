#!/bin/bash
set -euo pipefail

echo "=== Deploying to PRODUCTION environment ==="

# Configuration
TARGET_HOST="web1"
TARGET_DIR="/var/www/vhosts/simple.truvis.co"
SERVICE_NAME="simple-social-thing"
BINARY_SOURCE="backend/simple-social-thing-linux-amd64"

# Verify binary exists
if [ ! -f "$BINARY_SOURCE" ]; then
  echo "ERROR: Binary not found at $BINARY_SOURCE"
  echo "Run 'bash deploy/build.sh' first"
  exit 1
fi

echo "Binary found: $BINARY_SOURCE ($(du -h "$BINARY_SOURCE" | cut -f1))"

# Upload binary to target server
echo "Uploading binary to $TARGET_HOST..."
scp "$BINARY_SOURCE" grimlock@${TARGET_HOST}:/tmp/simple-social-thing

# Create systemd service file
echo "Creating systemd service file..."
cat > /tmp/simple-social-thing.service << 'EOF'
[Unit]
Description=Simple Social Thing
After=network-online.target

[Service]
User=grimlock
Group=grimlock
WorkingDirectory=/var/www/vhosts/simple.truvis.co
EnvironmentFile=/etc/simple-social-thing/config.ini
Environment=PORT=18911
ExecStart=/var/www/vhosts/simple.truvis.co/simple-social-thing
Restart=always
RestartSec=2s
NoNewPrivileges=true
LimitNOFILE=65536
StandardOutput=append:/var/www/vhosts/simple.truvis.co/logs/app.log
StandardError=append:/var/www/vhosts/simple.truvis.co/logs/error.log

[Install]
WantedBy=multi-user.target
EOF

# Upload service file and config sample
scp /tmp/simple-social-thing.service grimlock@${TARGET_HOST}:/tmp/simple-social-thing.service
scp deploy/config.ini.sample grimlock@${TARGET_HOST}:/tmp/config.ini.sample

# Deploy on target server
echo "Installing on $TARGET_HOST..."
ssh grimlock@${TARGET_HOST} "
  set -euo pipefail

  # Create directories
  sudo mkdir -p ${TARGET_DIR} ${TARGET_DIR}/logs
  sudo chown -R grimlock:grimlock ${TARGET_DIR}

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
  sudo mv /tmp/simple-social-thing ${TARGET_DIR}/simple-social-thing
  sudo chown grimlock:grimlock ${TARGET_DIR}/simple-social-thing
  sudo chmod 0755 ${TARGET_DIR}/simple-social-thing

  # Install systemd service
  sudo mv /tmp/simple-social-thing.service /etc/systemd/system/${SERVICE_NAME}.service
  sudo systemctl daemon-reload
  sudo systemctl enable ${SERVICE_NAME}

  # Restart service
  sudo systemctl restart ${SERVICE_NAME}

  # Show status
  sleep 2
  sudo systemctl status ${SERVICE_NAME} --no-pager || true
"

# Cleanup
rm -f /tmp/simple-social-thing.service

echo "=== PRODUCTION deployment complete! ==="
echo "Service: $SERVICE_NAME"
echo "Location: $TARGET_DIR"
echo "Logs: $TARGET_DIR/logs/"
