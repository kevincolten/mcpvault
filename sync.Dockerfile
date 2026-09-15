# Obsidian Headless Sync sidecar. Keeps the shared vault volume in sync with
# Obsidian Sync so edits made through mcpvault reach every device.
FROM node:24-slim
RUN npm install -g obsidian-headless && npm cache clean --force
COPY sync-entrypoint.sh /usr/local/bin/sync-entrypoint.sh
# node is uid 1000, same as mcpvault, so both can write the vault
USER node
ENV HOME=/home/node VAULT_PATH=/vault/Main
WORKDIR /home/node
CMD ["sh", "/usr/local/bin/sync-entrypoint.sh"]
