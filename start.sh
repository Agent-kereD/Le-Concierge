#!/usr/bin/env bash
# Start the simulated concierge service (loopback only).
# Resident app: http://127.0.0.1:8124/   Concierge console: http://127.0.0.1:8124/admin
cd "$(dirname "$0")/concierge-app/server"
exec node server.js
