#!/usr/bin/env sh

set -eu

IFACE=$(route -n get default 2>/dev/null | grep "interface:" | head -n 1 | cut -d: -f2 | tr -d " ")
HOST_IP=$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)

if [ -z "$HOST_IP" ]; then
  HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
fi

if [ -z "$HOST_IP" ]; then
  echo "Could not detect local IP. Set NEXT_PUBLIC_YJS_WS_URL manually."
  exit 1
fi

echo "Using HOST_IP=$HOST_IP (interface=${IFACE:-unknown})"

PORT_3000_PIDS=$(lsof -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$PORT_3000_PIDS" ]; then
  echo "Port 3000 is busy; stopping existing process(es): $PORT_3000_PIDS"
  kill $PORT_3000_PIDS 2>/dev/null || true
fi

PORT_1234_PIDS=$(lsof -t -iTCP:1234 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$PORT_1234_PIDS" ]; then
  echo "Port 1234 is busy; stopping existing process(es): $PORT_1234_PIDS"
  kill $PORT_1234_PIDS 2>/dev/null || true
fi

sleep 1

NEXT_DEV_ORIGIN_HOST="$HOST_IP" NEXT_PUBLIC_YJS_WS_URL="ws://$HOST_IP:1234" concurrently -n web,collab -c auto "npm:dev:lan" "npm:collab:server"
