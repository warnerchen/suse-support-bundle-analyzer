import http from 'node:http';
import { ArchiveAnalyzer } from './analysis/archiveAnalyzer.js';
import {
  ANALYSIS_WORK_DIR,
  BUNDLE_STORAGE_DIR,
  CREATE_BUNDLE_STORAGE_DIR,
  HOST,
  MAX_UPLOAD_BYTES,
  METADATA_DIR,
  PORT,
  PRODUCT_OPTIONS,
  PUBLIC_DIR,
} from './config.js';
import { AnalysisJobRepository } from './repositories/analysisJobRepository.js';
import { AnalysisReportRepository } from './repositories/analysisReportRepository.js';
import { BundleRepository } from './repositories/bundleRepository.js';
import { AnalysisService } from './services/analysisService.js';
import { BundleService } from './services/bundleService.js';
import { NfsBundleStorage } from './storage/nfsBundleStorage.js';
import { allowedArchiveSuffixes } from './utils/archiveValidation.js';
import { sendError, sendJson, setSecurityHeaders } from './utils/http.js';
import { parseMultipartForm } from './utils/requestForm.js';
import { serveStaticFile } from './utils/staticFiles.js';

const storage = new NfsBundleStorage(BUNDLE_STORAGE_DIR, {
  createRoot: CREATE_BUNDLE_STORAGE_DIR,
});
const repository = new BundleRepository(METADATA_DIR);
const bundleService = new BundleService({ repository, storage });
const analysisService = new AnalysisService({
  analyzer: new ArchiveAnalyzer({ workDir: ANALYSIS_WORK_DIR }),
  bundleRepository: repository,
  jobRepository: new AnalysisJobRepository(METADATA_DIR),
  reportRepository: new AnalysisReportRepository(METADATA_DIR),
  storage,
});

await storage.ensureReady();
await analysisService.resumePendingJobs();

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);

  try {
    const url = new URL(request.url, `http://${request.headers.host ?? HOST}`);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (url.pathname === '/api/products' && request.method === 'GET') {
      sendJson(response, 200, {
        products: PRODUCT_OPTIONS,
        allowedArchiveSuffixes: allowedArchiveSuffixes(),
        maxUploadBytes: MAX_UPLOAD_BYTES,
      });
      return;
    }

    if (url.pathname === '/api/bundles' && request.method === 'GET') {
      sendJson(response, 200, { bundles: await bundleService.listBundles() });
      return;
    }

    if (url.pathname === '/api/analysis-jobs' && request.method === 'GET') {
      sendJson(response, 200, { analysisJobs: await analysisService.listJobs() });
      return;
    }

    if (url.pathname.startsWith('/api/analysis-jobs/') && request.method === 'GET') {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];

      if (parts.length === 4 && parts[3] === 'report') {
        const report = await analysisService.getReport(id);

        if (!report) {
          sendError(response, 404, 'Analysis report not found.');
          return;
        }

        sendJson(response, 200, { report });
        return;
      }

      if (parts.length === 3) {
        const analysisJob = await analysisService.getJob(id);

        if (!analysisJob) {
          sendError(response, 404, 'Analysis job not found.');
          return;
        }

        sendJson(response, 200, { analysisJob });
        return;
      }
    }

    if (url.pathname.startsWith('/api/bundles/') && request.method === 'GET') {
      const id = url.pathname.split('/').at(-1);
      const bundle = await bundleService.getBundle(id);

      if (!bundle) {
        sendError(response, 404, 'Bundle not found.');
        return;
      }

      sendJson(response, 200, { bundle });
      return;
    }

    if (url.pathname === '/api/bundles' && request.method === 'POST') {
      const contentLength = Number.parseInt(request.headers['content-length'] ?? '0', 10);

      if (contentLength > MAX_UPLOAD_BYTES + 16 * 1024) {
        sendError(response, 413, 'The selected file is larger than the upload limit.', {
          maxUploadBytes: MAX_UPLOAD_BYTES,
        });
        return;
      }

      const contentType = request.headers['content-type'] ?? '';
      if (!contentType.includes('multipart/form-data')) {
        sendError(response, 415, 'Upload must use multipart/form-data.');
        return;
      }

      const formData = await parseMultipartForm(request);
      const bundle = await bundleService.createFromFormData(formData);
      const analysisJob = await analysisService.createForBundle(bundle);
      sendJson(response, 201, { bundle, analysisJob });
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const served = await serveStaticFile(request, response, PUBLIC_DIR);

      if (served) {
        return;
      }
    }

    sendError(response, 404, 'Not found.');
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode === 500 ? 'Unexpected server error.' : error.message;

    if (statusCode === 500) {
      console.error(error);
    }

    sendError(response, statusCode, message, error.details);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SUSE Support Bundle Analyzer is running at http://${HOST}:${PORT}`);
});
