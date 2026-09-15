# MCPVault over HTTP (Coolify)

This fork adds a Streamable HTTP entrypoint (`http.ts`) next to the stock stdio one, plus a
Coolify stack that runs Obsidian and MCPVault on one shared vault volume.

## Stack

| Service       | Exposure                                   | Purpose                                     |
| ------------- | ------------------------------------------ | ------------------------------------------- |
| `obsidian`    | Tailscale IP, `:3010` http / `:3011` https | Obsidian desktop in the browser, basic auth |
| `mcpvault`    | internal only, `:3333`                     | MCP at `/mcp`, health at `/healthz`         |
| `authproxy`   | internal only                              | OAuth in front of mcpvault for Claude       |
| `cloudflared` | outbound                                   | `obsidian-mcp.kevincolten.com` -> authproxy |

Obsidian mounts the vault volume at `/vaults`, MCPVault at `/vault`.
The vault is `/vaults/<VAULT_NAME>` (default `Main`).

## Coolify env

| Var                 | Required | Notes                                         |
| ------------------- | -------- | --------------------------------------------- |
| `OBSIDIAN_PASSWORD` | yes      | Obsidian web UI password (user `kevin`)       |
| `PROXY_PASSWORD`    | yes      | Password on the authproxy OAuth login screen  |
| `TUNNEL_TOKEN`      | yes      | Cloudflare tunnel `obsidian-mcp`              |
| `VAULT_NAME`        | no       | Default `Main`                                |
| `READ_ONLY`         | no       | `true` hides write tools                      |
| `TAILSCALE_IP`      | no       | Default `100.83.15.84`                        |

## First run

1. Open `https://<tailscale-ip>:3011`, log in, "Open folder as vault" on `/vaults/Main`.
   Sign into Obsidian Sync there if you use it.
2. Add a Claude custom connector: `https://obsidian-mcp.kevincolten.com/mcp`.
   Claude opens the authproxy login; use `PROXY_PASSWORD`.

## Running http.ts elsewhere

Without the proxy, set a token and it guards itself:

```
npm install && npm run build
VAULT_PATH=~/Vault MCP_AUTH_TOKEN=dev node dist/http.js
```

Send `Authorization: Bearer dev`, or put the token in the path: `/mcp/dev`.
Serves both the 2025 stateless protocol and 2026-07-28.
