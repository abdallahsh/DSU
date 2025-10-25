#!/bin/bash
set -e

# Start Xvfb
Xvfb :99 -screen 0 1024x768x16 &

# Ensure user_data directory exists and is writable (no chown needed)
mkdir -p /usr/src/app/user_data
chmod 777 /usr/src/app/user_data

# Wait for Xvfb to initialize
sleep 1

# Start the Node app
exec node app.js