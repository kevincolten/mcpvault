import { test, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "./createServer.js";
import { UploadTokenStore } from "./uploads.js";
import { FileSystemService } from "./filesystem.js";
import { decodeFileBase64, decodeFileBase64Lenient } from "./files.js";
import { uploadBytes, validateUploadPath } from "./uploadhelpers.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

let vault: string;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), "mcpvault-uptools-")); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

async function connect(options: Parameters<typeof createServer>[1] = {}) {
  const server = createServer(vault, { version: "1.0.0", ...options });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { server, client, close: async () => { await client.close(); await server.close(); } };
}

test("lenient base64 accepts data URLs, whitespace, url-safe characters and missing padding", () => {
  const bytes = Buffer.from([0xfb, 0xff, 0xbf, 0x00, 0x10, 0x83]);
  const canonical = bytes.toString("base64");
  const urlSafe = canonical.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const wrapped = canonical.replace(/(.{4})/g, "$1\n  ");
  for (const input of [canonical, urlSafe, wrapped, "data:image/jpeg;base64," + canonical, "  " + canonical + "\n"]) {
    expect(decodeFileBase64Lenient(input)).toEqual(bytes);
  }
  expect(decodeFileBase64Lenient("AA")).toEqual(Buffer.from([0]));
  expect(() => decodeFileBase64Lenient("!!!!")).toThrow();
  expect(() => decodeFileBase64Lenient("A")).toThrow(/length/);
  expect(() => decodeFileBase64("AA==\n")).toThrow();
});

test("upload_file over MCP accepts tolerant base64", async () => {
  const { client, close } = await connect();
  try {
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const res = await client.callTool({ name: "upload_file", arguments: { path: "lenient.bin", contentBase64: "data:application/octet-stream;base64," + bytes.toString("base64").replace(/=+$/, "") } });
    expect(res.isError).toBeFalsy();
    expect(await readFile(join(vault, "lenient.bin"))).toEqual(bytes);
  } finally { await close(); }
});

test("validateUploadPath rejects traversal, absolute paths, directories and unconfirmed overwrite", () => {
  expect(validateUploadPath(" a/b.jpg ", undefined, undefined)).toBe("a/b.jpg");
  for (const bad of ["../x.jpg", "/abs.jpg", "a/../b.jpg", "dir/", "c:/x.jpg", "", ".obsidian/app.json"]) {
    expect(() => validateUploadPath(bad, undefined, undefined)).toThrow();
  }
  expect(() => validateUploadPath("a.jpg", true, undefined)).toThrow(/confirmPath/);
  expect(validateUploadPath("a.jpg", true, "a.jpg")).toBe("a.jpg");
});

test("uploadBytes round-trips raw bytes through the hardened path", async () => {
  const fs = new FileSystemService(vault);
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  const res = await uploadBytes(fs, { path: "raw/file.bin", data: bytes });
  expect(res.size).toBe(5);
  expect(await readFile(join(vault, "raw/file.bin"))).toEqual(bytes);
  await expect(uploadBytes(fs, { path: "raw/file.bin", data: bytes })).rejects.toThrow(/already exists/);
});

test("upload_file needs exactly one of sourceUrl or contentBase64 and refuses internal URLs", async () => {
  const { client, close } = await connect();
  try {
    expect((await client.callTool({ name: "upload_file", arguments: { path: "a.bin" } })).isError).toBe(true);
    expect((await client.callTool({ name: "upload_file", arguments: { path: "a.bin", contentBase64: "AA==", sourceUrl: "http://example.com/a" } })).isError).toBe(true);
    const internal = await client.callTool({ name: "upload_file", arguments: { path: "a.bin", sourceUrl: "http://127.0.0.1:9/a" } });
    expect(internal.isError).toBe(true);
    expect((internal.content as any)[0].text).toMatch(/private or internal/);
  } finally { await close(); }
});

test("upload_file can pull a file from sourceUrl", async () => {
  const bytes = Buffer.from([9, 8, 7, 0, 255]);
  const origin = createHttpServer((_req, res) => void res.writeHead(200).end(bytes));
  await new Promise<void>(r => origin.listen(0, "127.0.0.1", r));
  const port = (origin.address() as any).port;
  const { client, close } = await connect({ allowPrivateSourceUrls: true });
  try {
    const res = await client.callTool({ name: "upload_file", arguments: { path: "pulled/photo.jpg", sourceUrl: `http://127.0.0.1:${port}/x` } });
    expect(res.isError).toBeFalsy();
    expect(await readFile(join(vault, "pulled/photo.jpg"))).toEqual(bytes);
  } finally {
    await close();
    await new Promise<void>(r => origin.close(() => r()));
  }
});

test("request_upload_url is only offered with a token store and mints a usable ticket", async () => {
  const plain = await connect();
  try {
    expect((await plain.client.listTools()).tools.map(t => t.name)).not.toContain("request_upload_url");
  } finally { await plain.close(); }

  const uploadTokens = new UploadTokenStore();
  const { client, close } = await connect({ uploadTokens, uploadBaseUrl: "https://gw.example/obsidian-upload/" });
  try {
    expect((await client.listTools()).tools.map(t => t.name)).toContain("request_upload_url");
    const res = await client.callTool({ name: "request_upload_url", arguments: { path: "Personal/Claim/photo.jpg" } });
    expect(res.isError).toBeFalsy();
    const out = JSON.parse((res.content as any)[0].text);
    expect(out.uploadUrl).toMatch(/^https:\/\/gw\.example\/obsidian-upload\/[A-Za-z0-9_-]{40,}$/);
    expect(out.method).toBe("PUT");
    expect(out.singleUse).toBe(true);
    expect(uploadTokens.take(out.uploadUrl.split("/").pop())).toMatchObject({ path: "Personal/Claim/photo.jpg", overwrite: false });
    expect((await client.callTool({ name: "request_upload_url", arguments: { path: "../escape.jpg" } })).isError).toBe(true);
    expect((await client.callTool({ name: "request_upload_url", arguments: { path: "a.jpg", overwrite: true } })).isError).toBe(true);
  } finally { await close(); }
});

test("read-only mode hides and blocks request_upload_url", async () => {
  const { client, close } = await connect({ readOnly: true, uploadTokens: new UploadTokenStore() });
  try {
    expect((await client.listTools()).tools.map(t => t.name)).not.toContain("request_upload_url");
    expect((await client.callTool({ name: "request_upload_url", arguments: { path: "a.jpg" } })).isError).toBe(true);
  } finally { await close(); }
});
