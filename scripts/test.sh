#!/usr/bin/env bash
# Replicable by anyone: typecheck + full test suite in one command.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run typecheck
npm test
