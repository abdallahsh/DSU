#!/bin/sh
set -e

# Start Xvfb
Xvfb :99 -screen 0 1024x768x16 &

# Ensure user_data directory permissions
mkdir -p /usr/src/app/user_data
chown -R appuser:appgroup /usr/src/app/user_data

#!/bin/bash

# Start Xvfb
Xvfb :99 -screen 0 1024x768x16 &

# Wait for Xvfb to be ready
sleep 1

# Start the app with proper permissions
exec node app.js