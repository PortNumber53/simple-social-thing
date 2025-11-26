#!/bin/bash
set -e

echo "Deploying to DEV environment..."

# Set environment variables
export ENVIRONMENT=dev
export PORT=18911

# Copy binary to deployment location
echo "Copying binary..."
cp backend/bin/api /opt/simple-social-thing/dev/api

# Restart service
echo "Restarting service..."
sudo systemctl restart simple-social-thing-dev

echo "DEV deployment complete!"
