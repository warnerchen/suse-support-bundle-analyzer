import fs from 'node:fs/promises';
import path from 'node:path';

export class BundleRepository {
  constructor(metadataDir) {
    this.metadataDir = metadataDir;
    this.filePath = path.join(metadataDir, 'bundles.json');
    this.writeQueue = Promise.resolve();
  }

  async list() {
    await fs.mkdir(this.metadataDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const records = JSON.parse(raw);

      if (!Array.isArray(records)) {
        return [];
      }

      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async findById(id) {
    const records = await this.list();
    return records.find((record) => record.id === id) ?? null;
  }

  async save(record) {
    return this.#serialize(async () => {
      const records = await this.list();
      records.unshift(record);
      await this.#writeAll(records);
      return record;
    });
  }

  async saveIfNotDuplicate(record) {
    return this.#serialize(async () => {
      const records = await this.list();
      const existing = records.find((candidate) => candidate.sha256 === record.sha256);

      if (existing) {
        return {
          duplicate: true,
          record: existing,
        };
      }

      records.unshift(record);
      await this.#writeAll(records);

      return {
        duplicate: false,
        record,
      };
    });
  }

  async delete(id) {
    return this.#serialize(async () => {
      const records = await this.list();
      const nextRecords = records.filter((record) => record.id !== id);

      if (nextRecords.length === records.length) {
        return false;
      }

      await this.#writeAll(nextRecords);
      return true;
    });
  }

  async #writeAll(records) {
    await fs.mkdir(this.metadataDir, { recursive: true });

    const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }

  async #serialize(operation) {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }
}
