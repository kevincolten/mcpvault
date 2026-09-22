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
import { createServer as createHttpServer } from "node:http";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./src/createServer.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")).version;
const vaultPath = resolve(process.env.VAULT_PATH || "/vault");
const port = Number(process.env.PORT || 3333);
const host = process.env.HOST || "0.0.0.0";
const token = process.env.MCP_AUTH_TOKEN || "";
const allowNoAuth = process.env.ALLOW_NO_AUTH === "true";
const readOnly = process.env.READ_ONLY === "true";
if (!token && !allowNoAuth) {
    console.error("MCP_AUTH_TOKEN is not set. Set it, or set ALLOW_NO_AUTH=true if something else guards this endpoint.");
    process.exit(1);
}
const handler = createMcpHandler(() => createServer(vaultPath, { version: VERSION, readOnly }), { onerror: (err) => console.error("[mcp]", err.message) });
function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}
// Returns true if the request is allowed to reach /mcp.
function authorized(req, pathToken) {
    if (!token)
        return true;
    if (pathToken && safeEqual(pathToken, token))
        return true;
    const header = req.headers.authorization || "";
    const m = header.match(/^Bearer\s+(.+)$/i);
    return !!m && safeEqual(m[1].trim(), token);
}
function toWebRequest(req, url) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined)
            continue;
        if (Array.isArray(v))
            v.forEach((x) => headers.append(k, x));
        else
            headers.set(k, v);
    }
    const init = { method: req.method || "GET", headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = Readable.toWeb(req);
        init.duplex = "half";
    }
    return new Request(url, init);
}
async function sendWebResponse(res, response) {
    const headers = {};
    response.headers.forEach((value, key) => {
        const existing = headers[key];
        if (existing === undefined)
            headers[key] = value;
        else
            headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    });
    res.writeHead(response.status, headers);
    if (!response.body) {
        res.end();
        return;
    }
    const body = Readable.fromWeb(response.body);
    res.on("close", () => body.destroy());
    body.pipe(res);
}
const httpServer = createHttpServer(async (req, res) => {
    try {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        if (url.pathname === "/healthz") {
            res.writeHead(200, { "content-type": "text/plain" }).end("ok");
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
    }
    catch (err) {
        console.error("[http]", err);
        if (!res.headersSent)
            res.writeHead(500);
        res.end();
    }
});
httpServer.listen(port, host, () => {
    console.log(`mcpvault v${VERSION} http on ${host}:${port} vault=${vaultPath} readOnly=${readOnly} auth=${token ? "on" : "off"}`);
});
async function shutdown() {
    httpServer.close();
    try {
        await handler.close();
    }
    catch { }
    process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
