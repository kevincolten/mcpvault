import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { decodeFileBase64, MAX_FILE_BYTES } from './files.js';

let root: string;
let outside: string;
let fs: FileSystemService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-files-'));
  outside = await mkdtemp(join(tmpdir(), 'mcpvault-outside-'));
  fs = new FileSystemService(root);
});
afterEach(async () => {
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
});

test.each(['', 'AA==', 'AP+A', 'JVBERi0xLjQK'])('canonical base64 round-trips %s', value => {
  expect(decodeFileBase64(value).toString('base64')).toBe(value);
});
test.each(['!', 'a', 'AA', 'AB==', 'AAAA=', 'AA==\n', 'data:application/pdf;base64,AA==', 'AA-_', 'A==='])(
  'rejects malformed base64 %s', value => {
    expect(() => decodeFileBase64(value)).toThrow();
  },
);
test('rejects missing data and payloads above the limit', () => {
  expect(() => decodeFileBase64(undefined as any)).toThrow();
  expect(() => decodeFileBase64(Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64'))).toThrow(/limit/);
});

test('uploads exact binary bytes, verifies checksum, and retrieves MIME metadata', async () => {
  const bytes = Buffer.from([0, 255, 128, 13, 10, 1]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const result = await fs.uploadFile({ path: 'Attachments/receipts/file.PDF', contentBase64: bytes.toString('base64'), sha256 });
  expect(result).toMatchObject({ success: true, size: 6, mimeType: 'application/pdf', sha256 });
  expect(await readFile(join(root, result.path))).toEqual(bytes);
  const downloaded = await fs.readBinaryFile(result.path);
  expect(downloaded.contentBase64).toBe(bytes.toString('base64'));
  expect(downloaded.sha256).toBe(sha256);
  expect(await readdir(join(root, 'Attachments/receipts'))).toEqual(['file.PDF']);
});
test('checksum mismatch and invalid overwrite do not create files', async () => {
  await expect(fs.uploadFile({ path: 'receipt.pdf', contentBase64: 'AA==', sha256: '0'.repeat(64) })).rejects.toThrow(/checksum/);
  await expect(fs.uploadFile({ path: 'receipt.pdf', contentBase64: 'AA==', overwrite: 'true' as any })).rejects.toThrow(/boolean/);
  expect(await readdir(root)).toEqual([]);
});
test('overwrite is explicit, confirmed, and never leaves partial files', async () => {
  const path = 'receipt.pdf';
  await fs.uploadFile({ path, contentBase64: 'AA==' });
  await expect(fs.uploadFile({ path, contentBase64: 'AQ==' })).rejects.toThrow(/already exists/);
  await expect(fs.uploadFile({ path, contentBase64: 'AQ==', overwrite: true })).rejects.toThrow(/confirmPath/);
  await expect(fs.uploadFile({ path, contentBase64: 'AQ==', overwrite: true, confirmPath: 'other.pdf' })).rejects.toThrow(/confirmPath/);
  expect((await fs.readBinaryFile(path)).contentBase64).toBe('AA==');
  await fs.uploadFile({ path, contentBase64: 'AQ==', overwrite: true, confirmPath: path });
  expect((await fs.readBinaryFile(path)).contentBase64).toBe('AQ==');
  expect(await readdir(root)).toEqual([path]);
});
test('concurrent creation does not clobber an existing file', async () => {
  const results = await Promise.allSettled(['AA==', 'AQ=='].map(contentBase64 => fs.uploadFile({ path: 'race.bin', contentBase64 })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect(['AA==', 'AQ==']).toContain((await fs.readBinaryFile('race.bin')).contentBase64);
  expect(await readdir(root)).toEqual(['race.bin']);
});
test.each(['', '../escape.pdf', 'new/../../escape.pdf', '/tmp/escape.pdf', 'C:\\escape.pdf',
  '.obsidian/settings.json', 'nested/.git/config', 'nested/node_modules/pkg/file.pdf', '.secret.pdf',
  'Attachments/../.obsidian/config', 'file.pdf:stream', 'nul\0.pdf'])('rejects restricted path %s', async path => {
  await expect(fs.uploadFile({ path, contentBase64: 'AA==' })).rejects.toThrow();
  await expect(fs.readBinaryFile(path)).rejects.toThrow();
});
test('honors configured ignored paths for both transfer operations', async () => {
  fs = new FileSystemService(root, new PathFilter({ ignoredPatterns: ['private/**'] }));
  await mkdir(join(root, 'private'));
  await writeFile(join(root, 'private/a.pdf'), 'private');
  await expect(fs.readBinaryFile('private/a.pdf')).rejects.toThrow(/denied/);
  await expect(fs.uploadFile({ path: 'private/new.pdf', contentBase64: 'AA==' })).rejects.toThrow(/denied/);
});
test('rejects directories and preserves them on overwrite', async () => {
  await mkdir(join(root, 'folder'));
  await expect(fs.readBinaryFile('folder')).rejects.toThrow(/regular file/);
  await expect(fs.uploadFile({ path: 'folder', contentBase64: '', overwrite: true, confirmPath: 'folder' })).rejects.toThrow(/regular file/);
  expect(await readdir(join(root, 'folder'))).toEqual([]);
});
test('rejects symlinks, including parents of destinations that do not exist yet', async () => {
  await writeFile(join(outside, 'external.pdf'), 'untouched');
  await symlink(outside, join(root, 'outside'));
  await symlink(join(outside, 'external.pdf'), join(root, 'file.pdf'));
  await mkdir(join(root, '.obsidian'));
  await writeFile(join(root, '.obsidian/private.pdf'), 'private');
  await symlink(join(root, '.obsidian'), join(root, 'alias'));
  for (const path of ['outside/external.pdf', 'file.pdf', 'alias/private.pdf']) {
    await expect(fs.readBinaryFile(path)).rejects.toThrow();
  }
  for (const path of ['outside/new/deep/file.pdf', 'alias/new/deep/file.pdf', 'file.pdf']) {
    await expect(fs.uploadFile({ path, contentBase64: 'AA==', overwrite: true, confirmPath: path })).rejects.toThrow();
  }
  expect(await readdir(outside)).toEqual(['external.pdf']);
  expect(await readFile(join(outside, 'external.pdf'), 'utf8')).toBe('untouched');
  expect(await readdir(join(root, '.obsidian'))).toEqual(['private.pdf']);
});
test('reads empty files and unknown MIME types; rejects missing or oversized files', async () => {
  await fs.uploadFile({ path: 'empty.bin', contentBase64: '' });
  expect(await fs.readBinaryFile('empty.bin')).toMatchObject({ size: 0, mimeType: 'application/octet-stream', contentBase64: '' });
  await expect(fs.readBinaryFile('missing.pdf')).rejects.toThrow();
  await writeFile(join(root, 'large.pdf'), '');
  await truncate(join(root, 'large.pdf'), MAX_FILE_BYTES + 1);
  await expect(fs.readBinaryFile('large.pdf')).rejects.toThrow(/limit/);
});

test('path canonicalization handles long dot/space runs and preserves exclusions', () => {
  const filter = new PathFilter();
  expect(filter.isAllowedForListing('Attachments/a' + ' .'.repeat(10000) + 'z.pdf')).toBe(true);
  expect(filter.isAllowedForListing('nested/.git' + ' .'.repeat(10000) + '/config')).toBe(false);
});
