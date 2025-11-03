#!/bin/bash
set -e

echo "Deploying to PRODUCTION environment..."

# Set environment variables
export ENVIRONMENT=production
export PORT=18002

# Copy binary to deployment location
echo "Copying binary..."
cp backend/bin/api /opt/simple-social-thing/production/api

# Restart service
echo "Restarting service..."
sudo systemctl restart simple-social-thing-production

echo "PRODUCTION deployment complete!"
