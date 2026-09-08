#!/usr/bin/env bash
set -euo pipefail
exec bun "$(cd "$(dirname "$0")" && pwd)/install.ts" "$@"
