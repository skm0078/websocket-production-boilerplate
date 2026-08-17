#!/usr/bin/env bash
# Build images and start the stack (websocket + redis) detached.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose build
docker compose up -d
docker compose ps
