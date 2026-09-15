#!/bin/sh
# Waits until the vault has been linked (one-time, via Coolify terminal),
# then runs continuous sync. Restarts sync if it ever exits.
mkdir -p "$VAULT_PATH" 2>/dev/null || true

while true; do
  if ob sync-status --path "$VAULT_PATH" >/dev/null 2>&1; then
    echo "[sync] starting continuous sync for $VAULT_PATH"
    ob sync --continuous --path "$VAULT_PATH"
    echo "[sync] sync exited with $?, restarting in 10s"
    sleep 10
  else
    echo "[sync] vault not linked yet. In this container's terminal run:"
    echo "  ob login"
    echo "  ob sync-list-remote"
    echo "  ob sync-setup --vault \"<remote vault name>\" --path $VAULT_PATH --device-name coolify"
    sleep 60
  fi
done
