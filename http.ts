#!/usr/bin/env node

// Streamable HTTP entrypoint for MCPVault.
// Serves the same tools as server.ts (stdio) over HTTP so remote clients
// like Claude web/mobile can reach a vault living on a server.
//
// Env:
//   VAULT_PATH       vault root (default /vault)
//   PORT             listen port (default 3333)
//   HOST             bind address (default 0.0.0.0)
//   MCP_AUTH_TOKEN   required unless ALLOW_NO_AUTH=true. Accepted as
//                    "Authorization: Bearer <token>" or as a path segment:
//                    /mcp/<token>  (handy for clients that can't set headers)
//   READ_ONLY        "true" to expose read tools only
//   UPLOAD_PUBLIC_BASE_URL  public base the one-time upload token is appended to,
//                    e.g. https://mcp.austindevs.com/obsidian-upload (the gateway
//                    forwards PUT <base>/<token> to this server's /upload/<token>)
//   ALLOW_PRIVATE_SOURCE_URLS  "true" lets upload_file sourceUrl fetch private addresses

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./src/createServer.js";
import { FileSystemService } from "./src/filesystem.js";
import { MAX_FILE_BYTES } from "./src/files.js";
import { uploadBytes } from "./src/uploadhelpers.js";
import { UploadTokenStore } from "./src/uploads.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION: string = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")).version;

const vaultPath = resolve(process.env.VAULT_PATH || "/vault");
const port = Number(process.env.PORT || 3333);
const host = process.env.HOST || "0.0.0.0";
const token = process.env.MCP_AUTH_TOKEN || "";
const allowNoAuth = process.env.ALLOW_NO_AUTH === "true";
const readOnly = process.env.READ_ONLY === "true";
const uploadBaseUrl = (process.env.UPLOAD_PUBLIC_BASE_URL || "").trim();
const allowPrivateSourceUrls = process.env.ALLOW_PRIVATE_SOURCE_URLS === "true";

// One store for the whole process: request_upload_url (an MCP tool) mints
// tickets, the /upload/<token> route below redeems them.
const uploadTokens = new UploadTokenStore();
const uploadFs = new FileSystemService(vaultPath);

if (!token && !allowNoAuth) {
  console.error("MCP_AUTH_TOKEN is not set. Set it, or set ALLOW_NO_AUTH=true if something else guards this endpoint.");
  process.exit(1);
}

const handler = createMcpHandler(
  () => createServer(vaultPath, { version: VERSION, readOnly, uploadTokens, uploadBaseUrl, allowPrivateSourceUrls }),
  { onerror: (err) => console.error("[mcp]", err.message) },
);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Returns true if the request is allowed to reach /mcp.
function authorized(req: IncomingMessage, pathToken: string | undefined): boolean {
  if (!token) return true;
  if (pathToken && safeEqual(pathToken, token)) return true;
  const header = req.headers.authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return !!m && safeEqual(m[1]!.trim(), token);
}

function toWebRequest(req: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  const init: RequestInit & { duplex?: "half" } = { method: req.method || "GET", headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    const existing = headers[key];
    if (existing === undefined) headers[key] = value;
    else headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(response.body as any);
  res.on("close", () => body.destroy());
  body.pipe(res);
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "File exceeds the 10 MiB transfer limit");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, "File exceeds the 10 MiB transfer limit");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

// PUT or POST /upload/<token>: raw file bytes, no base64. The token minted by
// request_upload_url is the credential, so this route skips the bearer check.
async function handleUpload(req: IncomingMessage, res: ServerResponse, url: URL, uploadToken: string): Promise<void> {
  if (req.method !== "PUT" && req.method !== "POST") {
    res.writeHead(405, { allow: "PUT, POST" }).end();
    return;
  }
  if (readOnly) {
    json(res, 403, { error: "read_only" });
    return;
  }
  const ticket = uploadTokens.take(uploadToken);
  if (!ticket) {
    json(res, 404, { error: "unknown_or_expired_upload_link" });
    return;
  }
  try {
    const data = await readBody(req, MAX_FILE_BYTES);
    if (data.length === 0) throw new HttpError(400, "Empty body: send the file bytes, e.g. curl -X PUT --data-binary @file <url>");
    const sha256 = url.searchParams.get("sha256") || undefined;
    const result = await uploadBytes(uploadFs, {
      path: ticket.path,
      data,
      sha256,
      overwrite: ticket.overwrite,
      confirmPath: ticket.overwrite ? ticket.path : undefined,
    });
    console.log(`[upload] ${result.path} ${result.size}B`);
    json(res, 200, result);
  } catch (err) {
    // Let the same link be retried until it expires.
    uploadTokens.restore(uploadToken, ticket);
    const status = err instanceof HttpError ? err.status : 400;
    json(res, status, { error: err instanceof Error ? err.message : "upload failed" });
  }
}

const httpServer = createHttpServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    const uploadMatch = url.pathname.match(/^\/upload\/([A-Za-z0-9_-]{20,128})$/);
    if (uploadMatch) {
      await handleUpload(req, res, url, uploadMatch[1]!);
      return;
    }

    const match = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
    if (!match) {
      res.writeHead(404).end();
      return;
    }

    if (!authorized(req, match[1])) {
      res.writeHead(401, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // Normalize to /mcp so the token never reaches the handler.
    url.pathname = "/mcp";
    const response = await handler.fetch(toWebRequest(req, url));
    await sendWebResponse(res, response);
  } catch (err) {
    console.error("[http]", err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

httpServer.listen(port, host, () => {
  console.log(`mcpvault v${VERSION} http on ${host}:${port} vault=${vaultPath} readOnly=${readOnly} auth=${token ? "on" : "off"}`);
});

async function shutdown() {
  httpServer.close();
  try { await handler.close(); } catch {}
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
