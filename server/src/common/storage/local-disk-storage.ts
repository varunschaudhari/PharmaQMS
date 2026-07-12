import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { FileStorage, StoredFile } from './file-storage.interface';

// Dev/test FileStorage implementation — one file + a sidecar .meta.json (content type) per key
// under a root directory. Immutability: writeFile with the 'wx' flag fails if the key exists.
@Injectable()
export class LocalDiskStorage implements FileStorage {
  constructor(private readonly rootDir: string) {}

  private resolvePath(key: string): string {
    const resolved = normalize(join(this.rootDir, key));
    // Defense in depth: keys are server-generated, but never allow escaping the root.
    if (!resolved.startsWith(normalize(this.rootDir) + sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return resolved;
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer, { flag: 'wx' });
    await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }), { flag: 'wx' });
  }

  async get(key: string): Promise<StoredFile> {
    const filePath = this.resolvePath(key);
    const [buffer, metaRaw] = await Promise.all([readFile(filePath), readFile(`${filePath}.meta.json`, 'utf8')]);
    const meta = JSON.parse(metaRaw) as { contentType: string };
    return { buffer, contentType: meta.contentType };
  }
}
