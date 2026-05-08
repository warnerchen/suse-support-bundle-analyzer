import {
  KB_REMOTE_FETCH_TIMEOUT_MS,
  KB_REMOTE_IMPORT_LIMIT,
  KB_TEXT_IMPORT_MAX_BYTES,
} from '../config.js';
import { extractDocumentLinks, normalizeKbDocument } from './kbText.js';

const SUPPORTED_MARKDOWN_SUFFIXES = ['.md', '.markdown'];
const REMOTE_DOCUMENT_MIN_CHARS = 120;

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
};

export class KbService {
  constructor({
    store,
    fetchImpl = globalThis.fetch,
    fetchTimeoutMs = KB_REMOTE_FETCH_TIMEOUT_MS,
    importLimit = KB_REMOTE_IMPORT_LIMIT,
    maxTextBytes = KB_TEXT_IMPORT_MAX_BYTES,
  }) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.importLimit = importLimit;
    this.maxTextBytes = maxTextBytes;
  }

  async ensureReady() {
    await this.store.ensureReady();
  }

  async getStatus() {
    return this.store.getStats();
  }

  async importFromUrls(urls, { expandLinks = true, productType = null } = {}) {
    const requestedUrls = sanitizeUrls(urls);

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

    const uniqueUrls = [...new Set(importUrls)].slice(0, this.importLimit);
    const documents = [];

    for (const url of uniqueUrls) {
      try {
        const page = await this.#fetchText(url);
        const document = normalizeKbDocument({
          content: page.content,
          sourceUri: page.url,
          contentType: page.contentType,
          productType,
        });
        const validationMessage = validateRemoteDocument(document);

        if (validationMessage) {
          failures.push({ url, message: validationMessage });
          continue;
        }

        documents.push(document);
      } catch (error) {
        failures.push({ url, message: error.message });
      }
    }

    const result = await this.store.upsertDocuments(documents);

    return {
      requestedUrls,
      discoveredUrls: uniqueUrls.length,
      failures,
      ...result,
    };
  }

  async importFromFiles(files, { productType = null } = {}) {
    const fileList = Array.isArray(files) ? files : [files].filter(Boolean);

    if (!fileList.length) {
      throw validationError('Select at least one Markdown file to import.');
    }

    const documents = [];
    const failures = [];

    for (const file of fileList) {
      try {
        const name = String(file.name ?? 'knowledge-base.md');

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

        documents.push(
          normalizeKbDocument({
            content,
            sourceUri: `uploaded://${encodeURIComponent(name)}`,
            contentType: file.type || 'text/markdown',
            productType,
          }),
        );
      } catch (error) {
        failures.push({
          filename: file?.name ?? 'unknown',
          message: error.message,
        });
      }
    }

    const result = await this.store.upsertDocuments(documents);

    return {
      requestedFiles: fileList.length,
      failures,
      ...result,
    };
  }

  async search(query, options = {}) {
    return this.store.search(query, options);
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
