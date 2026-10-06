#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

echo "Starting SIP demo stack (Kamailio + Node SIP web client)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build

echo "Done."
echo "SIP Web client: http://localhost:8088"
echo "Kamailio SIP UDP/TCP: localhost:5060"
echo "Kamailio SIP WebSocket: ws://localhost:5066"

