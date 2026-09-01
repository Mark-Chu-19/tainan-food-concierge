#!/usr/bin/env bash
# One-command launcher for the Tainan Food Concierge demo.
# Starts the backend bridge (:8787) and the React frontend (Vite), then
# stops both when you press Ctrl+C.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🍜 Starting Tainan Food Concierge…"

# Install deps on first run
[ -d "$DIR/backend/node_modules" ]  || (cd "$DIR/backend"  && npm install)
[ -d "$DIR/frontend/node_modules" ] || (cd "$DIR/frontend" && npm install)

# Backend
(cd "$DIR/backend" && node server.js) &
BACK=$!

# Frontend (Vite prints the exact localhost URL — usually 5173/5174)
(cd "$DIR/frontend" && npm run dev) &
FRONT=$!

trap 'echo; echo "Stopping…"; kill $BACK $FRONT 2>/dev/null; exit 0' INT TERM
echo "→ Backend  : http://localhost:8787"
echo "→ Frontend : watch the Vite line below for the exact URL (5173/5174)"
echo "   (Ctrl+C stops both)"
wait
