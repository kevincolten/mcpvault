import { createHash } from 'node:crypto';
import { extname } from 'node:path';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BASE64_LENGTH = 4 * Math.ceil(MAX_FILE_BYTES / 3);
export function decodeFileBase64(value) {
    if (typeof value !== 'string')
        throw new Error('contentBase64 must be a base64 string');
    if (value.length > MAX_FILE_BASE64_LENGTH)
        throw new Error('File exceeds the 10 MiB transfer limit');
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
        throw new Error('contentBase64 must be canonical base64, without whitespace or a data URL prefix');
    }
    const data = Buffer.from(value, 'base64');
    if (data.toString('base64') !== value)
        throw new Error('Invalid base64 encoding');
    if (data.length > MAX_FILE_BYTES)
        throw new Error('File exceeds the 10 MiB transfer limit');
    return data;
}
const MIME_TYPES = {
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
export function fileMetadata(path, data) {
    return {
        path,
        size: data.length,
        mimeType: MIME_TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
        sha256: createHash('sha256').update(data).digest('hex'),
        uri: 'obsidian-vault:///' + path.split('/').map(encodeURIComponent).join('/'),
    };
}
