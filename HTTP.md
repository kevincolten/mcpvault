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
| `UPLOAD_PUBLIC_BASE_URL` | no | Public base for one-time upload links (default `https://mcp.austindevs.com/obsidian-upload`) |
| `ALLOW_PRIVATE_SOURCE_URLS` | no | `true` lets `upload_file` `sourceUrl` fetch private addresses (off by default) |

## Getting files into the vault

`upload_file` no longer needs the caller to retype bytes. Three ways in:

1. `request_upload_url(path)` returns a one-time link. The caller sends raw bytes to it,
   for example `curl -sS -X PUT --data-binary @photo.jpg '<uploadUrl>'`. The link is
   single use, expires in 10 minutes, writes only to the requested path, and a failed
   attempt (bad checksum, too large) leaves it usable until it expires. Add `?sha256=<hex>`
   to have the server verify the bytes. Max 10 MiB.
2. `upload_file` with `sourceUrl`: the server downloads a public http(s) URL itself.
   Loopback, private, link-local and other internal addresses are refused, redirects are
   re-checked, and the 10 MiB cap applies.
3. `upload_file` with `contentBase64`: tolerates data URL prefixes, whitespace and line
   breaks, URL-safe characters and missing padding.

The upload link only works through the gateway, which exposes `PUT /obsidian-upload/<token>`
and forwards to `http://obsidian-mcpvault:3333/upload/<token>`. The token is the only
credential on that route.

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
