# MCPVault over HTTP (Coolify)

This fork adds a Streamable HTTP entrypoint (`http.ts`) next to the stock stdio one, plus a
Coolify stack that runs Obsidian and MCPVault on one shared vault volume.

## Stack

| Service    | Exposure                                   | Purpose                                     |
| ---------- | ------------------------------------------ | ------------------------------------------- |
| `obsidian` | Tailscale IP, `:3010` http / `:3011` https | Obsidian desktop in the browser, basic auth |
| `mcpvault` | `coolify` network as `obsidian-mcpvault`   | MCP at `/mcp`, health at `/healthz`         |

Nothing is public. The austindevs-mcp gateway (also on the `coolify` network) is the
single way in:

- URL: `http://obsidian-mcpvault:3333/mcp`
- Auth: bearer token, value of `MCP_AUTH_TOKEN`

Obsidian mounts the vault volume at `/vaults`, MCPVault at `/vault`.
The vault is `/vaults/<VAULT_NAME>` (default `Main`).

## Coolify env

| Var                 | Required | Notes                                   |
| ------------------- | -------- | --------------------------------------- |
| `OBSIDIAN_PASSWORD` | yes      | Obsidian web UI password (user `kevin`) |
| `MCP_AUTH_TOKEN`    | yes      | Bearer token the gateway sends          |
| `VAULT_NAME`        | no       | Default `Main`                          |
| `READ_ONLY`         | no       | `true` hides write tools                |
| `TAILSCALE_IP`      | no       | Default `100.83.15.84`                  |

## First run

Open `https://<tailscale-ip>:3011`, log in, "Open folder as vault" on `/vaults/Main`.
Sign into Obsidian Sync there if you use it.

## Running http.ts elsewhere

```
npm install && npm run build
VAULT_PATH=~/Vault MCP_AUTH_TOKEN=dev node dist/http.js
```

Send `Authorization: Bearer dev`, or put the token in the path: `/mcp/dev`.
Serves both the 2025 stateless protocol and 2026-07-28.
