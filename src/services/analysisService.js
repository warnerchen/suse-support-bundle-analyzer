import crypto from 'node:crypto';

export class AnalysisService {
  constructor({ analyzer, bundleRepository, jobRepository, reportRepository, storage }) {
    this.analyzer = analyzer;
    this.bundleRepository = bundleRepository;
    this.jobRepository = jobRepository;
    this.reportRepository = reportRepository;
    this.storage = storage;
    this.pendingJobIds = [];
    this.processing = false;
  }

  async createForBundle(bundle) {
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(),
      bundleId: bundle.id,
      productType: bundle.productType,
      status: 'queued',
      stage: 'waiting',
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorMessage: null,
      reportAvailable: false,
    };

    await this.jobRepository.save(job);
    this.enqueue(job.id);
    return job;
  }

  async listJobs() {
    return this.jobRepository.list();
  }

  async getJob(id) {
    return this.jobRepository.findById(id);
  }

  async getReport(jobId) {
    return this.reportRepository.findByJobId(jobId);
  }

  async hasRunningJobForBundle(bundleId) {
    const jobs = await this.jobRepository.findByBundleId(bundleId);
    return jobs.some((job) => job.status === 'running');
  }

  async deleteForBundle(bundleId) {
    const jobs = await this.jobRepository.deleteByBundleId(bundleId);
    const deletedJobIds = jobs.map((job) => job.id);
    this.pendingJobIds = this.pendingJobIds.filter((jobId) => !deletedJobIds.includes(jobId));

    for (const jobId of deletedJobIds) {
      await this.reportRepository.delete(jobId);

      if (typeof this.analyzer.deleteWorkDir === 'function') {
        await this.analyzer.deleteWorkDir(jobId);
      }
    }

    return jobs;
  }

  async resumePendingJobs() {
    const jobs = await this.jobRepository.list();

    for (const job of jobs) {
      if (job.status !== 'queued' && job.status !== 'running') {
        continue;
      }

      await this.jobRepository.update(job.id, {
        status: 'queued',
        stage: 'waiting',
        startedAt: null,
        errorMessage: null,
      });
      this.enqueue(job.id);
    }
  }

  enqueue(jobId) {
    if (!this.pendingJobIds.includes(jobId)) {
      this.pendingJobIds.push(jobId);
    }

    setTimeout(() => {
      this.#drainQueue().catch((error) => {
        console.error(error);
      });
    }, 0);
  }

  async #drainQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.pendingJobIds.length) {
        const jobId = this.pendingJobIds.shift();
        await this.#processJob(jobId);
      }
    } finally {
      this.processing = false;
    }
  }

  async #processJob(jobId) {
    const existingJob = await this.jobRepository.findById(jobId);

    if (!existingJob || existingJob.status !== 'queued') {
      return;
    }

    await this.jobRepository.update(jobId, {
      status: 'running',
      stage: 'preparing',
      startedAt: new Date().toISOString(),
      errorMessage: null,
    });

    try {
      const bundle = await this.bundleRepository.findById(existingJob.bundleId);

      if (!bundle) {
        throw new Error(`Bundle ${existingJob.bundleId} was not found.`);
      }

      const archivePath = this.storage.resolvePath(bundle.storageRelativePath);
      const report = await this.analyzer.analyze({
        archivePath,
        bundle,
        jobId,
        updateStage: (stage) => this.jobRepository.update(jobId, { stage }),
      });

      await this.reportRepository.save(jobId, report);
      await this.jobRepository.update(jobId, {
        status: 'completed',
        stage: 'completed',
        completedAt: new Date().toISOString(),
        reportAvailable: true,
        summary: report.summary,
      });
    } catch (error) {
      await this.jobRepository.update(jobId, {
        status: 'failed',
        stage: 'failed',
        failedAt: new Date().toISOString(),
        errorMessage: error.message,
      });
    }
  }
}
