import fs from 'node:fs/promises';
import path from 'node:path';

export class AnalysisJobRepository {
  constructor(metadataDir) {
    this.metadataDir = metadataDir;
    this.filePath = path.join(metadataDir, 'analysis-jobs.json');
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

  async findLatestByBundleId(bundleId) {
    const records = await this.list();
    return records.find((record) => record.bundleId === bundleId) ?? null;
  }

  async save(record) {
    return this.#serialize(async () => {
      const records = await this.list();
      records.unshift(record);
      await this.#writeAll(records);
      return record;
    });
  }

  async update(id, patch) {
    return this.#serialize(async () => {
      const records = await this.list();
      const index = records.findIndex((record) => record.id === id);

      if (index === -1) {
        return null;
      }

      const nextRecord = {
        ...records[index],
        ...patch,
        updatedAt: new Date().toISOString(),
      };

      records[index] = nextRecord;
      await this.#writeAll(records);
      return nextRecord;
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
