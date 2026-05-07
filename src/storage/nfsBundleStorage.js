import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class NfsBundleStorage {
  constructor(rootDir, { createRoot = false } = {}) {
    this.rootDir = rootDir;
    this.createRoot = createRoot;
  }

  async ensureReady() {
    if (this.createRoot) {
      await fsPromises.mkdir(this.rootDir, { recursive: true });
    }

    await fsPromises.access(this.rootDir, fs.constants.R_OK | fs.constants.W_OK);
  }

  async putFile(storageRelativePath, file) {
    await this.ensureReady();

    const targetPath = this.#resolveRelativePath(storageRelativePath);
    await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });

    const hash = crypto.createHash('sha256');
    let size = 0;

    const checksum = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(file.stream()),
      checksum,
      fs.createWriteStream(targetPath, { flags: 'wx' }),
    );

    return {
      storageBackend: 'nfs',
      storageRelativePath,
      size,
      sha256: hash.digest('hex'),
    };
  }

  resolvePath(storageRelativePath) {
    return this.#resolveRelativePath(storageRelativePath);
  }

  async deleteDirectory(storageRelativePath) {
    const targetPath = this.#resolveRelativePath(storageRelativePath);
    await fsPromises.rm(targetPath, { recursive: true, force: true });
  }

  #resolveRelativePath(storageRelativePath) {
    const normalized = path.normalize(storageRelativePath);

    if (
      normalized === '..' ||
      normalized.startsWith(`..${path.sep}`) ||
      path.isAbsolute(normalized)
    ) {
      throw new Error('Invalid NFS storage path');
    }

    const resolved = path.resolve(this.rootDir, normalized);
    const relative = path.relative(this.rootDir, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid NFS storage path');
    }

    return resolved;
  }
}
