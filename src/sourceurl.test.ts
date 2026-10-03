import { test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchSourceUrl, isPrivateAddress } from './sourceurl.js';

let server: Server;
let base: string;
const payload = Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2, 3, 250]);

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/file') return void res.writeHead(200).end(payload);
    if (req.url === '/hop') return void res.writeHead(302, { location: '/file' }).end();
    if (req.url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
    if (req.url === '/big') return void res.writeHead(200).end(Buffer.alloc(2048));
    res.writeHead(404).end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

test.each([
  ['127.0.0.1', true], ['10.1.2.3', true], ['172.20.0.5', true], ['192.168.1.1', true],
  ['169.254.169.254', true], ['100.64.0.1', true], ['::1', true], ['fd00::1', true],
  ['fe80::1', true], ['::ffff:10.0.0.1', true], ['8.8.8.8', false], ['1.1.1.1', false],
  ['2606:4700:4700::1111', false], ['not-an-ip', true],
])('isPrivateAddress(%s) = %s', (ip, expected) => {
  expect(isPrivateAddress(ip)).toBe(expected);
});

test('refuses private addresses by default', async () => {
  await expect(fetchSourceUrl(`${base}/file`)).rejects.toThrow(/private or internal/);
  await expect(fetchSourceUrl('http://localhost:1/file')).rejects.toThrow(/private or internal/);
});

test('rejects non-http schemes and junk', async () => {
  await expect(fetchSourceUrl('file:///etc/passwd')).rejects.toThrow(/http or https/);
  await expect(fetchSourceUrl('nope')).rejects.toThrow(/valid URL/);
});

test('downloads exact bytes, follows redirects, enforces limits', async () => {
  const opts = { allowPrivate: true };
  expect((await fetchSourceUrl(`${base}/file`, opts)).data).toEqual(payload);
  expect((await fetchSourceUrl(`${base}/hop`, opts)).data).toEqual(payload);
  await expect(fetchSourceUrl(`${base}/loop`, opts)).rejects.toThrow(/redirected too many/);
  await expect(fetchSourceUrl(`${base}/missing`, opts)).rejects.toThrow(/HTTP 404/);
  await expect(fetchSourceUrl(`${base}/big`, { ...opts, maxBytes: 1024 })).rejects.toThrow(/limit/);
});
