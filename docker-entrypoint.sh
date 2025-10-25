#!/bin/bash
set -e

# Start Xvfb
Xvfb :99 -screen 0 1024x768x16 &

# Wait for Xvfb to initialize
sleep 1

# Start the Node app
exec node app.js