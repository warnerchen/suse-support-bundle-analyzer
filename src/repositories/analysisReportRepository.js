import fs from 'node:fs/promises';
import path from 'node:path';

export class AnalysisReportRepository {
  constructor(metadataDir) {
    this.reportsDir = path.join(metadataDir, 'analysis-reports');
  }

  async save(jobId, report) {
    await fs.mkdir(this.reportsDir, { recursive: true });

    const reportPath = this.#reportPath(jobId);
    const tmpPath = `${reportPath}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, reportPath);
    return report;
  }

  async findByJobId(jobId) {
    try {
      const raw = await fs.readFile(this.#reportPath(jobId), 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async delete(jobId) {
    await fs.rm(this.#reportPath(jobId), { force: true });
  }

  #reportPath(jobId) {
    return path.join(this.reportsDir, `${jobId}.json`);
  }
}
