import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BASE64_LENGTH = 4 * Math.ceil(MAX_FILE_BYTES / 3);

export interface UploadFileParams {
  path: string;
  contentBase64: string;
  overwrite?: boolean;
  confirmPath?: string;
  /** Optional expected SHA-256 of the decoded bytes. */
  sha256?: string;
}

export function decodeFileBase64(value: string): Buffer {
  if (typeof value !== 'string') throw new Error('contentBase64 must be a base64 string');
  if (value.length > MAX_FILE_BASE64_LENGTH) throw new Error('File exceeds the 10 MiB transfer limit');
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('contentBase64 must be canonical base64, without whitespace or a data URL prefix');
  }
  const data = Buffer.from(value, 'base64');
  if (data.toString('base64') !== value) throw new Error('Invalid base64 encoding');
  if (data.length > MAX_FILE_BYTES) throw new Error('File exceeds the 10 MiB transfer limit');
  return data;
}

/**
 * Tolerant front door for base64 coming from a model or a human: accepts a
 * data URL prefix, line breaks and other whitespace, URL-safe -/_ characters,
 * and missing padding, then hands the cleaned string to the strict decoder.
 * decodeFileBase64 itself stays strict.
 */
export function normalizeBase64(value: string): string {
  if (typeof value !== 'string') throw new Error('contentBase64 must be a base64 string');
  if (value.length > MAX_FILE_BASE64_LENGTH * 2) throw new Error('File exceeds the 10 MiB transfer limit');
  let v = value.trim();
  const prefix = v.match(/^data:[^,]*;base64,/i);
  if (prefix) v = v.slice(prefix[0].length);
  v = v.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = v.length % 4;
  if (remainder === 1) throw new Error('contentBase64 has an impossible length; some characters were lost');
  if (remainder) v += '='.repeat(4 - remainder);
  return v;
}

export function decodeFileBase64Lenient(value: string): Buffer {
  return decodeFileBase64(normalizeBase64(value));
}

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.canvas': 'application/json',
  '.base': 'application/yaml',
  '.eml': 'message/rfc822',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function fileMetadata(path: string, data: Buffer) {
  return {
    path,
    size: data.length,
    mimeType: MIME_TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
    sha256: createHash('sha256').update(data).digest('hex'),
    uri: 'obsidian-vault:///' + path.split('/').map(encodeURIComponent).join('/'),
  };
}
