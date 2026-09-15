# MCPVault over HTTP (Coolify)

This fork adds a Streamable HTTP entrypoint (`http.ts`) next to the stock stdio one, plus a
Coolify stack that pairs it with Obsidian Headless Sync on one shared vault volume.

## Stack

| Service    | Exposure                                 | Purpose                                         |
| ---------- | ---------------------------------------- | ----------------------------------------------- |
| `mcpvault` | `coolify` network as `obsidian-mcpvault` | MCP at `/mcp`, health at `/healthz`             |
| `sync`     | outbound only                            | `ob sync --continuous` against Obsidian Sync    |

Nothing is public. The austindevs-mcp gateway (also on the `coolify` network) is the
single way in:

- URL: `http://obsidian-mcpvault:3333/mcp`
- Auth: bearer token, value of `MCP_AUTH_TOKEN`

Both services mount the vault at `/vault/<VAULT_NAME>` (default `Main`).
Sync credentials persist in the `sync-home` volume.

## Coolify env

| Var              | Required | Notes                          |
| ---------------- | -------- | ------------------------------ |
| `MCP_AUTH_TOKEN` | yes      | Bearer token the gateway sends |
| `VAULT_NAME`     | no       | Default `Main`                 |
| `READ_ONLY`      | no       | `true` hides write tools       |

## First run: link Sync (once)

Needs an active Obsidian Sync subscription. Open a terminal on the `sync` container in
Coolify and run:

```
ob login
ob sync-list-remote
ob sync-setup --vault "<remote vault name>" --path /vault/Main --device-name coolify
```

The container notices within a minute and starts continuous sync. Check with
`ob sync-status --path /vault/Main` or the container logs.

Do not also sign into Sync from a desktop Obsidian on this same vault folder.

## Running http.ts elsewhere

```
npm install && npm run build
VAULT_PATH=~/Vault MCP_AUTH_TOKEN=dev node dist/http.js
```

Send `Authorization: Bearer dev`, or put the token in the path: `/mcp/dev`.
Serves both the 2025 stateless protocol and 2026-07-28.
