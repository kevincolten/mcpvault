import { MAX_FILE_BYTES } from './files.js';
import type { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';

/**
 * Cheap up-front check so request_upload_url can refuse a bad destination
 * before minting a link. The real enforcement (symlinks, ancestors, existing
 * files) still happens in FileSystemService.uploadFile at write time.
 */
export function validateUploadPath(
  input: unknown,
  overwrite: unknown,
  confirmPath: unknown,
  pathFilter: PathFilter = new PathFilter(),
): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('path is required and must be a non-empty string');
  }
  if (overwrite !== undefined && typeof overwrite !== 'boolean') {
    throw new Error('overwrite must be a boolean');
  }
  const raw = input.trim().replace(/\\/g, '/');
  if (raw.startsWith('/') || raw.includes(':') || raw.includes('\0') ||
      raw.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('File transfers require a vault-relative path without traversal');
  }
  if (raw.endsWith('/') || !pathFilter.isAllowedForListing(raw)) {
    throw new Error('Access denied: restricted file path');
  }
  if (overwrite && (typeof confirmPath !== 'string' || confirmPath.trim() !== input.trim())) {
    throw new Error('Overwriting requires confirmPath to exactly match path');
  }
  return raw;
}

export interface UploadBytesParams {
  path: string;
  data: Buffer;
  sha256?: string | undefined;
  overwrite?: boolean | undefined;
  confirmPath?: string | undefined;
}

/** Write raw bytes through the same hardened path as base64 uploads. */
export function uploadBytes(fileSystem: FileSystemService, params: UploadBytesParams) {
  if (params.data.length > MAX_FILE_BYTES) throw new Error('File exceeds the 10 MiB transfer limit');
  return fileSystem.uploadFile({
    path: params.path,
    contentBase64: params.data.toString('base64'),
    ...(params.sha256 !== undefined && { sha256: params.sha256 }),
    ...(params.overwrite !== undefined && { overwrite: params.overwrite }),
    ...(params.confirmPath !== undefined && { confirmPath: params.confirmPath }),
  });
}
