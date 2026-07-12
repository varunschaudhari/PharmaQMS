// DOC-1 / SPEC.md §6: S3-compatible object storage for document files, certificates,
// attachments. Provider-agnostic boundary (same seam pattern as PLT-6's Mailer): dev/test bind
// the local-disk implementation; production binds an S3 adapter behind this same interface.
// Files are immutable per version (CLAUDE.md) — there is deliberately no update/delete API.
export interface StoredFile {
  buffer: Buffer;
  contentType: string;
}

export interface FileStorage {
  // Writes once; a key is never overwritten (immutability is enforced by the implementation).
  put(key: string, buffer: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile>;
}

export const FILE_STORAGE = 'FILE_STORAGE';
