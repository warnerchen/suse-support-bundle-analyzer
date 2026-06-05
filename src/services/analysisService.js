import crypto from 'node:crypto';

export class AnalysisService {
  constructor({ analyzer, bundleRepository, jobRepository, reportRepository, storage, kbService = null, logger = null }) {
    this.analyzer = analyzer;
    this.bundleRepository = bundleRepository;
    this.jobRepository = jobRepository;
    this.reportRepository = reportRepository;
    this.storage = storage;
    this.kbService = kbService;
    this.logger = logger;
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
    this.logger?.info('analysis.queued', {
      jobId: job.id,
      bundleId: job.bundleId,
      productType: job.productType,
    });
    return job;
  }

  async listJobs() {
    return this.jobRepository.list();
  }

  async getJob(id) {
    return this.jobRepository.findById(id);
  }

  async getReport(jobId) {
    let report = await this.reportRepository.findByJobId(jobId);

    if (!report) {
      return null;
    }

    if (typeof this.analyzer.enrichExistingReport === 'function') {
      report = await this.analyzer.enrichExistingReport(report);
    }

    return this.#enrichReport(report);
  }

  async getExtractedFile(jobId, { reportPath, lineStart = null, lineEnd = null, matchText = '' } = {}) {
    const job = await this.jobRepository.findById(jobId);

    if (!job) {
      const error = new Error('Analysis job not found.');
      error.statusCode = 404;
      throw error;
    }

    if (!reportPath) {
      const error = new Error('Provide a file path to preview.');
      error.statusCode = 400;
      throw error;
    }

    return this.analyzer.readExtractedFile({
      jobId,
      reportPath,
      lineStart,
      lineEnd,
      matchText,
    });
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
      this.logger?.debug('analysis.enqueued', {
        jobId,
        queueDepth: this.pendingJobIds.length,
      });
    }

    setTimeout(() => {
      this.#drainQueue().catch((error) => {
        this.logger?.error('analysis.queue_error', { error });
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
    const startedAt = Date.now();
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
    this.logger?.info('analysis.started', {
      jobId,
      bundleId: existingJob.bundleId,
      productType: existingJob.productType,
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
        updateStage: (stage) => {
          this.logger?.debug('analysis.stage', { jobId, stage });
          return this.jobRepository.update(jobId, { stage });
        },
      });
      const enrichedReport = await this.#enrichReport(report);

      await this.reportRepository.save(jobId, enrichedReport);
      await this.jobRepository.update(jobId, {
        status: 'completed',
        stage: 'completed',
        completedAt: new Date().toISOString(),
        reportAvailable: true,
        summary: enrichedReport.summary,
      });
      this.logger?.info('analysis.completed', {
        jobId,
        bundleId: existingJob.bundleId,
        productType: existingJob.productType,
        durationMs: Date.now() - startedAt,
        findingCount: enrichedReport.findings?.length ?? 0,
        findingGroupCount: enrichedReport.findingGroups?.length ?? 0,
      });
    } catch (error) {
      await this.jobRepository.update(jobId, {
        status: 'failed',
        stage: 'failed',
        failedAt: new Date().toISOString(),
        errorMessage: error.message,
      });
      this.logger?.error('analysis.failed', {
        jobId,
        bundleId: existingJob.bundleId,
        productType: existingJob.productType,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  }

  async #enrichReport(report) {
    if (!this.kbService) {
      return report;
    }

    try {
      return await this.kbService.enrichReport(report);
    } catch (error) {
      this.logger?.warn('analysis.kb_enrichment_failed', {
        jobId: report?.jobId,
        productType: report?.productType,
        error,
      });
      return {
        ...report,
        kbSummary: {
          enabled: false,
          errorMessage: error.message,
        },
      };
    }
  }
}
