export declare const MAX_FILE_BYTES: number;
export declare const MAX_FILE_BASE64_LENGTH: number;
export interface UploadFileParams {
    path: string;
    contentBase64: string;
    overwrite?: boolean;
    confirmPath?: string;
    /** Optional expected SHA-256 of the decoded bytes. */
    sha256?: string;
}
export declare function decodeFileBase64(value: string): Buffer;
export declare function fileMetadata(path: string, data: Buffer): {
    path: string;
    size: number;
    mimeType: string;
    sha256: string;
    uri: string;
};
//# sourceMappingURL=files.d.ts.map