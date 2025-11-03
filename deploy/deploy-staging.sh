#!/bin/bash
set -e

echo "Deploying to STAGING environment..."

# Set environment variables
export ENVIRONMENT=staging
export PORT=18002

# Copy binary to deployment location
echo "Copying binary..."
cp backend/bin/api /opt/simple-social-thing/staging/api

# Restart service
echo "Restarting service..."
sudo systemctl restart simple-social-thing-staging

echo "STAGING deployment complete!"
