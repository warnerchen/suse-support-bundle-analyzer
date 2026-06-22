import {
  KB_REMOTE_FETCH_TIMEOUT_MS,
  KB_REMOTE_IMPORT_LIMIT,
  KB_TEXT_IMPORT_MAX_BYTES,
} from '../config.js';
import { chunkKbDocument, extractDocumentLinks, normalizeKbDocument } from './kbText.js';

const SUPPORTED_MARKDOWN_SUFFIXES = ['.md', '.markdown'];
const REMOTE_DOCUMENT_MIN_CHARS = 120;
const SUPPORTED_PRODUCT_TYPES = new Set(['longhorn', 'harvester']);

const GROUP_QUERY_HINTS = {
  'longhorn-manager-stability':
    'longhorn manager panic crash crashloopbackoff manager logs backing image eviction inaccessible webhook',
  'longhorn-volume-replica-health':
    'longhorn volume degraded faulted replica failed rebuilding recovery attach failure replica health',
  'longhorn-replica-scheduling-capacity':
    'longhorn replica scheduling insufficient storage insufficient space volume not scheduled disk capacity node space',
  'longhorn-node-prerequisites':
    'longhorn node prerequisites required packages kernel modules multipathd iscsi open-iscsi selinux node scheduling',
  'longhorn-control-plane-endpoints':
    'longhorn webhook inaccessible connection refused csi socket manager crashloop endpoint healthz',
  'longhorn-pod-restarts':
    'longhorn instance manager pods restarted pod restarts recurring restart engine replica process',
  'longhorn-monitoring-alerts':
    'longhorn prometheus alert monitoring warning volume alert runbook',
  'longhorn-collection-gaps':
    'longhorn support bundle collect pod logs bundleGenerationError create support bundle troubleshooting',
  'harvester-control-plane-health':
    'harvester webhook api control plane pod restart addon catalog app admission validator 502 bad gateway',
  'harvester-virtualization-readiness':
    'harvester kubevirt cdi virtual machine scheduling live migration node selector vm image import upload',
  'harvester-vm-workload-health':
    'harvester virtual machine vmi vm scheduling unschedulable pending runStrategy printableStatus live migration virt-launcher node selector taint',
  'harvester-network-health':
    'harvester vm network vlan multus whereabouts bridge gro gso offload ethtool throughput connectivity',
  'harvester-storage-health':
    'harvester longhorn storage volume degraded unknown replica stopped not running no disks found disk not ready schedulable defaultdisk replica rebuild disk state warning',
  'harvester-node-health':
    'harvester node ready pressure ntp sync etcd voter maintenance scheduling taint label',
  'harvester-platform-events-and-logs':
    'harvester warning event platform log error kube-system harvester-system troubleshooting',
  'harvester-collection-gaps':
    'harvester support bundle collect pod logs bundleGenerationError kubevirt cdi api resources',
};

export class KbService {
  constructor({
    store,
    fetchImpl = globalThis.fetch,
    fetchTimeoutMs = KB_REMOTE_FETCH_TIMEOUT_MS,
    importLimit = KB_REMOTE_IMPORT_LIMIT,
    maxTextBytes = KB_TEXT_IMPORT_MAX_BYTES,
    logger = null,
  }) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.importLimit = importLimit;
    this.maxTextBytes = maxTextBytes;
    this.logger = logger;
  }

  async ensureReady() {
    await this.store.ensureReady();
  }

  async getStatus() {
    return this.store.getStats();
  }

  async listSources({ productType = null } = {}) {
    return this.store.listSources({ productType });
  }

  async previewFromUrls(urls, { expandLinks = true, productType = null } = {}) {
    const startedAt = Date.now();
    const prepared = await this.#prepareUrlImport(urls, { expandLinks, productType });
    const preview = buildPreviewSummary(prepared);
    this.logger?.info('kb.preview_urls.completed', {
      productType,
      expandLinks,
      requestedUrls: prepared.requestedUrls.length,
      discoveredUrls: prepared.discoveredUrls.length,
      importableCount: preview.importableCount,
      warningCount: preview.warningCount,
      blockedCount: preview.blockedCount,
      failureCount: preview.failures.length,
      durationMs: Date.now() - startedAt,
    });
    return preview;
  }

  async importFromUrls(urls, { expandLinks = true, productType = null } = {}) {
    const startedAt = Date.now();
    const prepared = await this.#prepareUrlImport(urls, { expandLinks, productType });
    const importableDocuments = prepared.documents
      .filter((entry) => entry.preview.importable)
      .map((entry) => entry.document);
    const blockedFailures = prepared.documents
      .filter((entry) => !entry.preview.importable)
      .map((entry) => ({
        url: entry.preview.sourceUri,
        message: entry.preview.qualityMessages[0] ?? 'Document did not pass KB quality checks.',
      }));

    const result = await this.store.upsertDocuments(importableDocuments);
    this.logger?.info('kb.import_urls.completed', {
      productType,
      expandLinks,
      requestedUrls: prepared.requestedUrls.length,
      discoveredUrls: prepared.discoveredUrls.length,
      documentsImported: result.documentsImported,
      chunksIndexed: result.chunksIndexed,
      failureCount: prepared.failures.length + blockedFailures.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      requestedUrls: prepared.requestedUrls,
      discoveredUrls: prepared.discoveredUrls.length,
      failures: [...prepared.failures, ...blockedFailures],
      preview: buildPreviewSummary(prepared),
      ...result,
    };
  }

  async previewFromFiles(files, { productType = null } = {}) {
    const startedAt = Date.now();
    const prepared = await this.#prepareFileImport(files, { productType });
    const preview = buildPreviewSummary(prepared);
    this.logger?.info('kb.preview_files.completed', {
      productType,
      requestedFiles: prepared.requestedFiles,
      importableCount: preview.importableCount,
      warningCount: preview.warningCount,
      blockedCount: preview.blockedCount,
      failureCount: preview.failures.length,
      durationMs: Date.now() - startedAt,
    });
    return preview;
  }

  async importFromFiles(files, { productType = null } = {}) {
    const startedAt = Date.now();
    const prepared = await this.#prepareFileImport(files, { productType });
    const importableDocuments = prepared.documents
      .filter((entry) => entry.preview.importable)
      .map((entry) => entry.document);
    const blockedFailures = prepared.documents
      .filter((entry) => !entry.preview.importable)
      .map((entry) => ({
        filename: entry.preview.filename ?? entry.preview.title,
        message: entry.preview.qualityMessages[0] ?? 'Document did not pass KB quality checks.',
      }));

    const result = await this.store.upsertDocuments(importableDocuments);
    this.logger?.info('kb.import_files.completed', {
      productType,
      requestedFiles: prepared.requestedFiles,
      documentsImported: result.documentsImported,
      chunksIndexed: result.chunksIndexed,
      failureCount: prepared.failures.length + blockedFailures.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      requestedFiles: prepared.requestedFiles,
      failures: [...prepared.failures, ...blockedFailures],
      preview: buildPreviewSummary(prepared),
      ...result,
    };
  }

  async deleteSource(id) {
    const deleted = await this.store.deleteDocument(id);

    if (!deleted) {
      const error = new Error('KB source not found.');
      error.statusCode = 404;
      throw error;
    }

    this.logger?.info('kb.source_deleted', {
      sourceId: deleted.id,
      productType: deleted.productType,
      removedChunks: deleted.removedChunks,
      totalDocuments: deleted.totalDocuments,
      totalChunks: deleted.totalChunks,
    });

    return deleted;
  }

  async search(query, options = {}) {
    const startedAt = Date.now();
    const results = await this.store.search(query, options);
    this.logger?.debug('kb.search.completed', {
      productType: options.productType,
      limit: options.limit,
      resultCount: results.length,
      durationMs: Date.now() - startedAt,
    });
    return results;
  }

  async enrichReport(report) {
    const stats = await this.store.getStats();
    const kbSummary = {
      enabled: stats.chunkCount > 0,
      documentCount: stats.documentCount,
      chunkCount: stats.chunkCount,
      updatedAt: stats.updatedAt,
      embedding: stats.embedding,
    };

    if (!report?.findingGroups?.length || !stats.chunkCount) {
      return {
        ...report,
        kbSummary,
      };
    }

    const findingGroups = [];

    for (const group of report.findingGroups) {
      const query = buildKbQuery({ group, report });
      const relatedKb = await this.store.search(query, {
        productType: report.productType,
        limit: 3,
        minScore: 0.08,
      });

      findingGroups.push({
        ...group,
        relatedKb,
      });
    }

    return {
      ...report,
      kbSummary,
      findingGroups,
    };
  }

  async #fetchText(sourceUrl) {
    let url;

    try {
      url = new URL(sourceUrl);
    } catch {
      throw validationError(`Invalid URL: ${sourceUrl}`);
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw validationError(`Unsupported KB URL protocol: ${url.protocol}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await this.fetchImpl(url.href, {
        headers: {
          Accept: 'text/html,text/markdown,text/plain;q=0.9,*/*;q=0.1',
          'User-Agent': 'suse-support-bundle-analyzer/0.1',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Fetch failed with HTTP ${response.status}.`);
      }

      const contentType = response.headers.get('content-type') ?? '';

      if (!isTextContent(contentType)) {
        throw new Error(`Unsupported KB content type: ${contentType || 'unknown'}.`);
      }

      const content = await response.text();
      const byteLength = Buffer.byteLength(content, 'utf8');

      if (byteLength > this.maxTextBytes) {
        throw new Error(`KB document is larger than ${this.maxTextBytes} bytes.`);
      }

      return {
        url: response.url || url.href,
        contentType,
        content,
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Fetch timed out after ${this.fetchTimeoutMs} ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async #prepareUrlImport(urls, { expandLinks = true, productType = null } = {}) {
    const requestedUrls = sanitizeUrls(urls);
    const normalizedProductType = normalizeImportProductType(productType);

    if (!requestedUrls.length) {
      throw validationError('Provide at least one KB URL to import.');
    }

    const importUrls = [];
    const failures = [];

    for (const sourceUrl of requestedUrls) {
      try {
        const page = await this.#fetchText(sourceUrl);
        const links = expandLinks ? extractDocumentLinks(page.content, page.url) : [];

        if (shouldExpandLinks(page.url, links, expandLinks)) {
          importUrls.push(...links);
        } else {
          importUrls.push(page.url);
        }
      } catch (error) {
        failures.push({ url: sourceUrl, message: error.message });
      }
    }

    const allUniqueUrls = [...new Set(importUrls)];
    const uniqueUrls = allUniqueUrls.slice(0, this.importLimit);
    const documents = [];

    for (const url of uniqueUrls) {
      try {
        const page = await this.#fetchText(url);
        const document = normalizeKbDocument({
          content: page.content,
          sourceUri: page.url,
          contentType: page.contentType,
          productType: normalizedProductType,
        });

        documents.push({
          document,
          preview: buildDocumentPreview(document, { remote: true }),
        });
      } catch (error) {
        failures.push({ url, message: error.message });
      }
    }

    return {
      requestedUrls,
      requestedFiles: 0,
      discoveredUrls: uniqueUrls,
      truncated: allUniqueUrls.length > uniqueUrls.length,
      failures,
      documents,
    };
  }

  async #prepareFileImport(files, { productType = null } = {}) {
    const fileList = Array.isArray(files) ? files : [files].filter(Boolean);
    const normalizedProductType = normalizeImportProductType(productType);

    if (!fileList.length) {
      throw validationError('Select at least one Markdown file to import.');
    }

    const documents = [];
    const failures = [];

    for (const file of fileList) {
      const name = String(file?.name ?? 'knowledge-base.md');

      try {
        if (!isMarkdownFilename(name)) {
          throw new Error('Only .md and .markdown files are supported.');
        }

        if (Number.isFinite(file.size) && file.size > this.maxTextBytes) {
          throw new Error(`KB file is larger than ${this.maxTextBytes} bytes.`);
        }

        const content = await file.text();
        const byteLength = Buffer.byteLength(content, 'utf8');

        if (byteLength > this.maxTextBytes) {
          throw new Error(`KB file is larger than ${this.maxTextBytes} bytes.`);
        }

        const document = normalizeKbDocument({
          content,
          sourceUri: `uploaded://${encodeURIComponent(name)}`,
          contentType: file.type || 'text/markdown',
          productType: normalizedProductType,
        });

        documents.push({
          document,
          preview: {
            ...buildDocumentPreview(document),
            filename: name,
          },
        });
      } catch (error) {
        failures.push({
          filename: name,
          message: error.message,
        });
      }
    }

    return {
      requestedUrls: [],
      requestedFiles: fileList.length,
      discoveredUrls: [],
      truncated: false,
      failures,
      documents,
    };
  }
}

function sanitizeUrls(urls) {
  const values = Array.isArray(urls) ? urls : [urls];

  return [
    ...new Set(
      values
        .flatMap((value) => String(value ?? '').split(/\s+/))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function shouldExpandLinks(sourceUrl, links, expandLinks) {
  if (!expandLinks || links.length < 2) {
    return false;
  }

  try {
    const { pathname } = new URL(sourceUrl);
    return pathname !== '/' && pathname.endsWith('/');
  } catch {
    return false;
  }
}

function isMarkdownFilename(filename) {
  const lower = filename.toLowerCase();
  return SUPPORTED_MARKDOWN_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function normalizeImportProductType(productType) {
  const normalized = String(productType ?? '').trim().toLowerCase();

  if (SUPPORTED_PRODUCT_TYPES.has(normalized)) {
    return normalized;
  }

  throw validationError('Choose a supported product before importing KB sources.');
}

function validateRemoteDocument(document) {
  const body = document.body.trim();

  if (isDynamicShellDocument(document)) {
    return 'Fetched page did not contain readable KB article content. This source may require JavaScript rendering or a Markdown/export source.';
  }

  if (body.length < REMOTE_DOCUMENT_MIN_CHARS) {
    return 'Fetched page did not contain enough readable KB article content.';
  }

  return '';
}

function buildPreviewSummary(prepared) {
  const documents = prepared.documents.map((entry) => entry.preview);

  return {
    requestedUrls: prepared.requestedUrls,
    requestedFiles: prepared.requestedFiles,
    discoveredUrls: prepared.discoveredUrls,
    discoveredUrlCount: prepared.discoveredUrls.length,
    truncated: prepared.truncated,
    documents,
    failures: prepared.failures,
    readyCount: documents.filter((document) => document.status === 'ready').length,
    warningCount: documents.filter((document) => document.status === 'warning').length,
    blockedCount: documents.filter((document) => document.status === 'blocked').length,
    importableCount: documents.filter((document) => document.importable).length,
  };
}

function buildDocumentPreview(document, { remote = false } = {}) {
  const blockingMessages = [];
  const warningMessages = [];
  const body = document.body.trim();
  const chunks = chunkKbDocument(document);

  if (remote) {
    const remoteValidationMessage = validateRemoteDocument(document);

    if (remoteValidationMessage) {
      blockingMessages.push(remoteValidationMessage);
    }
  }

  if (!body) {
    blockingMessages.push('Document does not contain readable text.');
  } else if (!chunks.length) {
    blockingMessages.push('Document is too short to create a searchable KB chunk.');
  }

  if (!blockingMessages.length && body.length < 500) {
    warningMessages.push('Readable content is short; confirm this is the article body before importing.');
  }

  if (!blockingMessages.length && /^untitled kb article$/i.test(document.title)) {
    warningMessages.push('Document title could not be detected.');
  }

  const importable = !blockingMessages.length;
  const status = importable ? (warningMessages.length ? 'warning' : 'ready') : 'blocked';
  const qualityMessages = blockingMessages.length
    ? blockingMessages
    : warningMessages.length
      ? warningMessages
      : ['Ready to import.'];

  return {
    id: document.id,
    title: document.title,
    sourceUri: document.sourceUri,
    productType: document.productType,
    contentType: document.contentType,
    charCount: body.length,
    chunkCount: chunks.length,
    status,
    importable,
    qualityMessages,
    excerpt: createPreviewExcerpt(body),
  };
}

function createPreviewExcerpt(body) {
  const normalized = body.replace(/\s+/g, ' ').trim();
  const excerpt = normalized.slice(0, 280);
  return `${excerpt}${normalized.length > excerpt.length ? '...' : ''}`;
}

function isDynamicShellDocument(document) {
  const body = document.body.replace(/\s+/g, ' ').trim();

  return (
    /^(SUSE Customer Portal|Salesforce)$/i.test(document.title) &&
    /Loading/i.test(body) &&
    /Sorry to interrupt|CSS Error|Refresh/i.test(body)
  );
}

function isTextContent(contentType) {
  return (
    !contentType ||
    contentType.includes('text/') ||
    contentType.includes('application/xhtml') ||
    contentType.includes('application/xml')
  );
}

function buildKbQuery({ group, report }) {
  const metadata = report.inventory?.metadata ?? {};
  const findings = (report.findings ?? [])
    .filter((finding) => group.relatedFindingIds?.includes(finding.id))
    .flatMap((finding) => [finding.title, finding.description, ...(finding.evidence ?? []).slice(0, 2)]);

  return [
    GROUP_QUERY_HINTS[group.id],
    report.productType,
    metadata.kubernetesversion,
    metadata.issuedescription,
    group.title,
    group.description,
    group.impact,
    ...(group.affected ?? []),
    ...(group.recommendedChecks ?? []),
    ...(group.evidence ?? []).slice(0, 4),
    ...findings,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000);
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
