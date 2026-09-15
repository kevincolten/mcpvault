# MCPVault over HTTP (Coolify)

This fork adds a Streamable HTTP entrypoint (`http.ts`) next to the stock stdio one, plus a
Coolify stack that runs Obsidian and MCPVault side by side on one shared vault volume.

## What runs

| Service    | Image                              | Port | Purpose                                      |
| ---------- | ---------------------------------- | ---- | -------------------------------------------- |
| `obsidian` | `lscr.io/linuxserver/obsidian`     | 3000 | Obsidian desktop in the browser, basic auth  |
| `mcpvault` | built from this repo               | 3333 | MCP endpoint at `/mcp`, health at `/healthz` |

Both mount the `vault` volume. Obsidian sees it at `/vaults`, MCPVault at `/vault`.
The vault itself is `/vaults/<VAULT_NAME>` (default `Main`).

## Deploy

1. Coolify: new resource, Docker Compose, point it at this repo, compose file `docker-compose.yml`.
2. Set domains for `obsidian` and `mcpvault`.
3. Deploy. Coolify generates `SERVICE_USER_OBSIDIAN`, `SERVICE_PASSWORD_OBSIDIAN`, and
   `SERVICE_PASSWORD_64_MCP` (the MCP token). Copy them from the stack's env tab.
4. Open the Obsidian domain, log in, and "Open folder as vault" on `/vaults/Main`.
   If you use Obsidian Sync, sign in there and point Sync at that vault.

## Connect Claude

Add a custom connector with the token in the path:

```
https://<mcpvault-domain>/mcp/<SERVICE_PASSWORD_64_MCP>
```

Clients that can send headers can use `https://<mcpvault-domain>/mcp` with
`Authorization: Bearer <token>` instead.

## Env

| Var              | Default   | Notes                                                    |
| ---------------- | --------- | -------------------------------------------------------- |
| `VAULT_PATH`     | `/vault`  | Vault root inside the container                          |
| `PORT`           | `3333`    |                                                          |
| `MCP_AUTH_TOKEN` | none      | Required unless `ALLOW_NO_AUTH=true`                     |
| `READ_ONLY`      | `false`   | Hide and reject write tools                              |
| `VAULT_NAME`     | `Main`    | Compose only; folder under the shared volume             |
| `TZ`             | `America/Los_Angeles` | Compose only; Obsidian container timezone    |

## Local

```
npm install && npm run build
VAULT_PATH=~/Vault MCP_AUTH_TOKEN=dev node dist/http.js
```

Serves both the 2025 stateless protocol (what Claude.ai uses today) and 2026-07-28.
