#!/bin/sh
set -e
# Fresh named volumes are root-owned. Create the vault dir and hand it to uid 1000
# (node here, abc in the Obsidian container) before dropping privileges.
mkdir -p "$VAULT_PATH"
chown 1000:1000 "$(dirname "$VAULT_PATH")" "$VAULT_PATH" 2>/dev/null || true
exec su-exec node "$@"
