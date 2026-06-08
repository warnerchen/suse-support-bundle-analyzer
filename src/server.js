import crypto from 'node:crypto';
import http from 'node:http';
import { createAiAdvisorService } from './ai/advisorFactory.js';
import { ArchiveAnalyzer } from './analysis/archiveAnalyzer.js';
import {
  ANALYSIS_WORK_DIR,
  BUNDLE_STORAGE_DIR,
  CREATE_BUNDLE_STORAGE_DIR,
  HOST,
  KB_STORAGE_DIR,
  MAX_UPLOAD_BYTES,
  METADATA_DIR,
  PORT,
  PRODUCT_OPTIONS,
  PUBLIC_DIR,
} from './config.js';
import { createKbEmbeddingProvider } from './kb/embeddingProviderFactory.js';
import { KbService } from './kb/kbService.js';
import { KbStore } from './kb/kbStore.js';
import { createKbVectorStore } from './kb/vectorStoreFactory.js';
import { AnalysisJobRepository } from './repositories/analysisJobRepository.js';
import { AnalysisReportRepository } from './repositories/analysisReportRepository.js';
import { BundleRepository } from './repositories/bundleRepository.js';
import { AnalysisService } from './services/analysisService.js';
import { BundleService } from './services/bundleService.js';
import { NfsBundleStorage } from './storage/nfsBundleStorage.js';
import { allowedArchiveSuffixes } from './utils/archiveValidation.js';
import { sendError, sendJson, setSecurityHeaders } from './utils/http.js';
import { readJsonBody } from './utils/jsonBody.js';
import { logger } from './utils/logger.js';
import { parseMultipartForm } from './utils/requestForm.js';
import { serveStaticFile } from './utils/staticFiles.js';

const storage = new NfsBundleStorage(BUNDLE_STORAGE_DIR, {
  createRoot: CREATE_BUNDLE_STORAGE_DIR,
});
const repository = new BundleRepository(METADATA_DIR);
const bundleService = new BundleService({
  repository,
  storage,
  logger: logger.child({ component: 'bundle-service' }),
});
const kbStore = new KbStore({
  storageDir: KB_STORAGE_DIR,
  embeddingProvider: createKbEmbeddingProvider(),
  vectorStore: createKbVectorStore({ storageDir: KB_STORAGE_DIR }),
  logger: logger.child({ component: 'kb-store' }),
});
const kbService = new KbService({
  store: kbStore,
  logger: logger.child({ component: 'kb-service' }),
});
const aiAdvisorService = createAiAdvisorService({
  logger: logger.child({ component: 'ai-advisor' }),
});
const analysisService = new AnalysisService({
  analyzer: new ArchiveAnalyzer({ workDir: ANALYSIS_WORK_DIR }),
  bundleRepository: repository,
  jobRepository: new AnalysisJobRepository(METADATA_DIR),
  reportRepository: new AnalysisReportRepository(METADATA_DIR),
  storage,
  kbService,
  aiAdvisorService,
  logger: logger.child({ component: 'analysis-service' }),
});

await storage.ensureReady();
await kbService.ensureReady();
await analysisService.resumePendingJobs();

const server = http.createServer(async (request, response) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let requestPath = '';

  setSecurityHeaders(response);

  try {
    const url = new URL(request.url, `http://${request.headers.host ?? HOST}`);
    requestPath = url.pathname;

    if (requestPath.startsWith('/api/')) {
      response.on('finish', () => {
        logger.info('http.request', {
          requestId,
          method: request.method,
          path: requestPath,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        });
      });
    }

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

    if (url.pathname === '/api/kb/status' && request.method === 'GET') {
      sendJson(response, 200, { kb: await kbService.getStatus() });
      return;
    }

    if (url.pathname === '/api/kb/sources' && request.method === 'GET') {
      sendJson(response, 200, {
        sources: await kbService.listSources({
          productType: url.searchParams.get('productType'),
        }),
      });
      return;
    }

    if (url.pathname === '/api/kb/search' && request.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const productType = url.searchParams.get('productType');
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '5', 10);
      const results = await kbService.search(q, {
        productType,
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 5,
      });

      sendJson(response, 200, { results });
      return;
    }

    if (url.pathname === '/api/kb/preview-url' && request.method === 'POST') {
      const contentType = request.headers['content-type'] ?? '';

      if (!contentType.includes('application/json')) {
        sendError(response, 415, 'KB preview must use application/json.');
        return;
      }

      const body = await readJsonBody(request);
      const preview = await kbService.previewFromUrls(body.urls ?? body.url, {
        expandLinks: body.expandLinks !== false,
        productType: body.productType,
      });
      sendJson(response, 200, { preview, kb: await kbService.getStatus() });
      return;
    }

    if (url.pathname === '/api/kb/preview-files' && request.method === 'POST') {
      const contentType = request.headers['content-type'] ?? '';

      if (!contentType.includes('multipart/form-data')) {
        sendError(response, 415, 'KB file preview must use multipart/form-data.');
        return;
      }

      const formData = await parseMultipartForm(request);
      const preview = await kbService.previewFromFiles(formData.getAll('kbFiles'), {
        productType: formData.get('productType'),
      });
      sendJson(response, 200, { preview, kb: await kbService.getStatus() });
      return;
    }

    if (url.pathname === '/api/kb/import-url' && request.method === 'POST') {
      const contentType = request.headers['content-type'] ?? '';

      if (!contentType.includes('application/json')) {
        sendError(response, 415, 'KB import must use application/json.');
        return;
      }

      const body = await readJsonBody(request);
      const result = await kbService.importFromUrls(body.urls ?? body.url, {
        expandLinks: body.expandLinks !== false,
        productType: body.productType,
      });
      sendJson(response, 201, { import: result, kb: await kbService.getStatus() });
      return;
    }

    if (url.pathname === '/api/kb/import-files' && request.method === 'POST') {
      const contentType = request.headers['content-type'] ?? '';

      if (!contentType.includes('multipart/form-data')) {
        sendError(response, 415, 'KB file import must use multipart/form-data.');
        return;
      }

      const formData = await parseMultipartForm(request);
      const result = await kbService.importFromFiles(formData.getAll('kbFiles'), {
        productType: formData.get('productType'),
      });
      sendJson(response, 201, { import: result, kb: await kbService.getStatus() });
      return;
    }

    if (url.pathname.startsWith('/api/kb/sources/') && request.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      const deleted = await kbService.deleteSource(id);
      sendJson(response, 200, { deleted, kb: await kbService.getStatus() });
      return;
    }

    if (url.pathname.startsWith('/api/analysis-jobs/') && request.method === 'GET') {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[2];

      if (parts.length === 4 && parts[3] === 'files') {
        const file = await analysisService.getExtractedFile(id, {
          reportPath: url.searchParams.get('path'),
          lineStart: parsePositiveInteger(url.searchParams.get('lineStart')),
          lineEnd: parsePositiveInteger(url.searchParams.get('lineEnd')),
          matchText: url.searchParams.get('matchText') ?? '',
        });

        sendJson(response, 200, { file });
        return;
      }

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

    if (url.pathname.startsWith('/api/bundles/') && request.method === 'DELETE') {
      const id = url.pathname.split('/').at(-1);
      const bundle = await bundleService.getBundle(id);

      if (!bundle) {
        sendError(response, 404, 'Bundle not found.');
        return;
      }

      if (await analysisService.hasRunningJobForBundle(id)) {
        sendError(response, 409, 'Bundle analysis is currently running. Try deleting it again after analysis finishes.');
        return;
      }

      const deletedAnalysisJobs = await analysisService.deleteForBundle(id);
      const deletedBundle = await bundleService.deleteBundle(id);
      sendJson(response, 200, { bundle: deletedBundle, deletedAnalysisJobs });
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

    logger[statusCode === 500 ? 'error' : 'warn']('http.error', {
      requestId,
      method: request.method,
      path: requestPath,
      statusCode,
      error,
    });

    sendError(response, statusCode, message, error.details);
  }
});

server.listen(PORT, HOST, () => {
  logger.info('server.started', {
    host: HOST,
    port: PORT,
    publicDir: PUBLIC_DIR,
    metadataDir: METADATA_DIR,
    kbStorageDir: KB_STORAGE_DIR,
    bundleStorageDir: BUNDLE_STORAGE_DIR,
    aiAdvisorProvider: aiAdvisorService?.descriptor?.provider ?? 'off',
  });
  console.log(`SUSE Support Bundle Analyzer is running at http://${HOST}:${PORT}`);
});

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
