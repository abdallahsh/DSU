#!/bin/sh
set -e

# Start Xvfb
Xvfb :99 -screen 0 1024x768x16 &

# Ensure user_data directory permissions
mkdir -p /usr/src/app/user_data
chown -R appuser:appgroup /usr/src/app/user_data

# Start the application
exec node app.js