import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { MAX_FILE_BYTES } from './files.js';

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net4, prefix, 'ipv4');
}
for (const [net6, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  blocked.addSubnet(net6, prefix, 'ipv6');
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 0) return true;
  return blocked.check(address, kind === 6 ? 'ipv6' : 'ipv4');
}

export interface SourceFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Test and trusted-network escape hatch. */
  allowPrivate?: boolean;
}

export interface SourceFetchResult {
  data: Buffer;
  finalUrl: string;
}

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: any, callback: any) => {
    dns.lookup(hostname, { ...(options || {}), all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as unknown as dns.LookupAddress[];
      const usable = allowPrivate ? list : list.filter(a => !isPrivateAddress(a.address));
      if (usable.length === 0) {
        return callback(new Error('Source URL points at a private or internal address'));
      }
      if (options && options.all) return callback(null, usable);
      callback(null, usable[0]!.address, usable[0]!.family);
    });
  };
}

function parseSourceUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('sourceUrl is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('sourceUrl must use http or https');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(host) && isPrivateAddress(host)) {
    throw new Error('Source URL points at a private or internal address');
  }
  return url;
}

function once(url: URL, opts: Required<SourceFetchOptions>): Promise<{ status: number; location?: string; data?: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: 'GET',
      timeout: opts.timeoutMs,
      lookup: guardedLookup(opts.allowPrivate) as any,
      headers: { 'user-agent': 'mcpvault-fetch', accept: '*/*' },
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ status, location: String(res.headers.location) });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Source URL returned HTTP ${status}`));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        res.destroy();
        reject(new Error('File exceeds the 10 MiB transfer limit'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > opts.maxBytes) {
          res.destroy();
          reject(new Error('File exceeds the 10 MiB transfer limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, data: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Source URL timed out')));
    req.on('error', reject);
    req.end();
  });
}

export async function fetchSourceUrl(raw: string, options: SourceFetchOptions = {}): Promise<SourceFetchResult> {
  const opts: Required<SourceFetchOptions> = {
    maxBytes: options.maxBytes ?? MAX_FILE_BYTES,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxRedirects: options.maxRedirects ?? 3,
    allowPrivate: options.allowPrivate ?? false,
  };
  let url = parseSourceUrl(raw, opts.allowPrivate);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const result = await once(url, opts);
    if (result.data) return { data: result.data, finalUrl: url.toString() };
    url = parseSourceUrl(new URL(result.location!, url).toString(), opts.allowPrivate);
  }
  throw new Error('Source URL redirected too many times');
}
