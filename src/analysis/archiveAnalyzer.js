import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_EXTRACTED_BYTES,
  MAX_REPORT_FILE_ENTRIES,
} from '../config.js';
import {
  emptyProductAnalysis,
  getProductAnalyzer,
  productAnalyzerDescriptor,
} from './productAnalyzers.js';

const execFileAsync = promisify(execFile);
const FILE_PREVIEW_MAX_BYTES = 512 * 1024;
const FILE_PREVIEW_CONTEXT_LINES = 80;
const FILE_PREVIEW_MAX_LINE_WINDOW = 220;
const NESTED_ARCHIVE_MAX_DEPTH = 3;
const ANALYSIS_METADATA_DIRNAME = '.sba-analysis';
const NESTED_ARCHIVE_STATUS_DIRNAME = 'nested-archives';

export class ArchiveAnalyzer {
  constructor({ workDir, productAnalyzers = { get: getProductAnalyzer } }) {
    this.workDir = workDir;
    this.productAnalyzers = productAnalyzers;
  }

  async deleteWorkDir(jobId) {
    await fs.rm(path.join(this.workDir, jobId), { recursive: true, force: true });
  }

  async analyze({ archivePath, bundle, jobId, updateStage }) {
    const archiveType = inferArchiveType(bundle.storedFilename || bundle.originalFilename);

    if (!archiveType) {
      throw new Error('This archive type is not supported for analysis yet.');
    }

    const jobWorkDir = path.join(this.workDir, jobId);
    const extractDir = path.join(jobWorkDir, 'extracted');

    await updateStage('listing archive');
    await fs.rm(jobWorkDir, { recursive: true, force: true });
    await fs.mkdir(extractDir, { recursive: true });

    const archiveEntries = await listArchiveEntries(archivePath, archiveType);
    validateArchiveEntries(archiveEntries);

    await updateStage('extracting archive');
    try {
      await extractArchive(archivePath, archiveType, extractDir, {
        maxExtractedBytes: MAX_EXTRACTED_BYTES,
      });
    } catch (error) {
      await fs.rm(extractDir, { recursive: true, force: true });
      throw error;
    }

    await updateStage('expanding nested archives');
    await expandNestedArchives(extractDir, {
      maxExtractedBytes: MAX_EXTRACTED_BYTES,
    });

    await updateStage('indexing files');
    const index = await buildFileIndex(extractDir);
    const summary = summarizeFileIndex(index);

    if (summary.totalBytes > MAX_EXTRACTED_BYTES) {
      await fs.rm(extractDir, { recursive: true, force: true });
      throw new Error(
        `Extracted data is larger than the configured limit of ${MAX_EXTRACTED_BYTES} bytes.`,
      );
    }

    await updateStage('running product checks');
    const productAnalyzer = this.#getProductAnalyzer(bundle.productType);
    const productAnalysis = productAnalyzer
      ? await productAnalyzer.analyze({ extractDir, index })
      : emptyProductAnalysis();

    return {
      jobId,
      bundleId: bundle.id,
      productType: bundle.productType,
      generatedAt: new Date().toISOString(),
      archive: {
        filename: bundle.originalFilename,
        archiveType,
        fileSize: bundle.fileSize,
        sha256: bundle.sha256,
        storageBackend: bundle.storageBackend,
        storageRelativePath: bundle.storageRelativePath,
      },
      summary,
      analyzer: productAnalyzerDescriptor(productAnalyzer),
      inventory: productAnalysis.inventory,
      correlations: productAnalysis.correlations ?? {},
      groupSummary: productAnalysis.groupSummary,
      findingGroups: productAnalysis.findingGroups,
      findingSummary: productAnalysis.findingSummary,
      findings: productAnalysis.findings,
      topLevelEntries: summarizeTopLevelEntries(index),
      largestFiles: largestFiles(index, 10),
      fileIndex: index
        .filter((entry) => entry.type === 'file')
        .slice(0, MAX_REPORT_FILE_ENTRIES),
      notes: [
        productAnalysis.findings?.length
          ? 'Product-specific findings are heuristic checks and should be reviewed with the referenced source files.'
          : 'No product-specific findings were detected by the current rule set.',
      ],
    };
  }

  async readExtractedFile({
    jobId,
    reportPath,
    lineStart = null,
    lineEnd = null,
    matchText = '',
    searchText = '',
    searchRegex = false,
  }) {
    const normalizedPath = normalizePreviewPath(reportPath);
    const extractDir = path.join(this.workDir, jobId, 'extracted');
    const filePath = await safeResolveExistingFile(extractDir, normalizedPath);
    const stats = await fs.lstat(filePath);

    if (stats.isSymbolicLink()) {
      return unpreviewableFile(normalizedPath, 'symlink', 'Symlink preview is disabled.');
    }

    if (!stats.isFile()) {
      return unpreviewableFile(normalizedPath, stats.isDirectory() ? 'directory' : 'other', 'Only regular files can be previewed.');
    }

    const sample = await readFirstBytes(filePath, Math.min(FILE_PREVIEW_MAX_BYTES, stats.size));

    if (isBinaryBuffer(sample)) {
      return {
        path: normalizedPath,
        type: 'file',
        size: stats.size,
        previewable: false,
        binary: true,
        truncated: false,
        content: '',
        message: 'Binary file preview is not available.',
      };
    }

    const matchedLine = searchText
      ? await findMatchingLine(filePath, searchText, { minLength: 1, caseInsensitive: true, regex: searchRegex })
      : matchText
        ? await findMatchingLine(filePath, matchText)
        : null;
    const previewLineStart = matchedLine?.lineNumber ?? lineStart;
    const previewLineEnd = matchedLine?.lineNumber ?? lineEnd;

    if (previewLineStart) {
      const window = await readLineWindow(filePath, {
        lineStart: previewLineStart,
        lineEnd: previewLineEnd ?? previewLineStart,
        contextLines: FILE_PREVIEW_CONTEXT_LINES,
      });

      return {
        path: normalizedPath,
        type: 'file',
        size: stats.size,
        previewable: true,
        binary: false,
        truncated: window.truncated,
        content: window.content,
        lineStart: window.lineStart,
        lineEnd: window.lineEnd,
        requestedLineStart: previewLineStart,
        requestedLineEnd: previewLineEnd ?? previewLineStart,
        matchedLine: matchedLine
          ? {
              lineNumber: matchedLine.lineNumber,
              strategy: 'text',
            }
          : null,
      };
    }

    const content = sample.toString('utf8');

    return {
      path: normalizedPath,
      type: 'file',
      size: stats.size,
      previewable: true,
      binary: false,
      truncated: stats.size > sample.length,
      content,
      lineStart: 1,
      lineEnd: countLines(content),
      requestedLineStart: null,
      requestedLineEnd: null,
    };
  }

  async listExtractedFiles({ jobId }) {
    const extractDir = path.join(this.workDir, jobId, 'extracted');

    try {
      await fs.realpath(extractDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw previewError(404, 'Extracted bundle files are not available for this analysis job.');
      }

      throw error;
    }

    await expandNestedArchives(extractDir, {
      maxExtractedBytes: MAX_EXTRACTED_BYTES,
    });
    const index = await buildFileIndex(extractDir);

    return {
      summary: summarizeFileIndex(index),
      fileIndex: index.filter((entry) => entry.type === 'file'),
    };
  }

  async enrichExistingReport(report) {
    const productAnalyzer = this.#getProductAnalyzer(report.productType);

    if (!productAnalyzer || typeof productAnalyzer.enrichExistingReport !== 'function') {
      return report;
    }

    try {
      const extractDir = path.join(this.workDir, report.jobId, 'extracted');
      await expandNestedArchives(extractDir, {
        maxExtractedBytes: MAX_EXTRACTED_BYTES,
      });
      const index = await buildFileIndex(extractDir);
      const refreshedReport = {
        ...report,
        summary: summarizeFileIndex(index),
        topLevelEntries: summarizeTopLevelEntries(index),
        largestFiles: largestFiles(index, 10),
        fileIndex: index
          .filter((entry) => entry.type === 'file')
          .slice(0, MAX_REPORT_FILE_ENTRIES),
      };
      return productAnalyzer.enrichExistingReport(refreshedReport, { extractDir, index });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return report;
      }

      throw error;
    }
  }

  #getProductAnalyzer(productType) {
    if (typeof this.productAnalyzers?.get === 'function') {
      return this.productAnalyzers.get(productType);
    }

    return getProductAnalyzer(productType);
  }
}

function normalizePreviewPath(reportPath) {
  const normalizedPath = String(reportPath ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
  validateArchiveEntryPath(normalizedPath);
  return normalizedPath;
}

async function safeResolveExistingFile(rootDir, reportPath) {
  let rootRealPath;

  try {
    rootRealPath = await fs.realpath(rootDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw previewError(404, 'Extracted bundle files are not available for this analysis job.');
    }

    throw error;
  }

  const filePath = path.resolve(rootRealPath, reportPath);

  if (!isPathInside(rootRealPath, filePath)) {
    throw previewError(400, `File path is outside the extracted bundle: ${reportPath}`);
  }

  let fileRealPath;

  try {
    fileRealPath = await fs.realpath(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw previewError(404, 'File was not found in the extracted bundle.');
    }

    throw error;
  }

  if (!isPathInside(rootRealPath, fileRealPath)) {
    throw previewError(400, `File path resolves outside the extracted bundle: ${reportPath}`);
  }

  return fileRealPath;
}

function isPathInside(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function readFirstBytes(filePath, byteCount) {
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readLineWindow(filePath, { lineStart, lineEnd, contextLines }) {
  const targetStart = Math.max(1, lineStart - contextLines);
  const targetEnd = Math.max(targetStart, lineEnd + contextLines);
  const lines = [];
  let currentLine = 0;
  let truncated = false;
  let capturedBytes = 0;
  let reachedEnd = false;
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const reader = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      currentLine += 1;

      if (currentLine < targetStart) {
        continue;
      }

      if (currentLine > targetEnd) {
        reachedEnd = true;
        break;
      }

      capturedBytes += Buffer.byteLength(line, 'utf8') + 1;

      if (capturedBytes > FILE_PREVIEW_MAX_BYTES || lines.length >= FILE_PREVIEW_MAX_LINE_WINDOW) {
        truncated = true;
        break;
      }

      lines.push(line);
    }
  } finally {
    reader.close();
    input.destroy();
  }

  return {
    content: lines.join('\n'),
    lineStart: targetStart,
    lineEnd: targetStart + Math.max(0, lines.length - 1),
    truncated: truncated || targetStart > 1 || reachedEnd,
  };
}

async function findMatchingLine(
  filePath,
  matchText,
  { minLength = 16, caseInsensitive = false, regex = false } = {},
) {
  const needle = String(matchText ?? '').trim().replace(/\.\.\.$/, '').trim();

  if (needle.length < minLength) {
    return null;
  }

  let matcher;

  if (regex) {
    try {
      const searchRegex = new RegExp(needle, caseInsensitive ? 'i' : '');
      matcher = (line) => searchRegex.test(line);
    } catch {
      const error = new Error('Invalid regular expression search.');
      error.statusCode = 400;
      throw error;
    }
  } else {
    const normalizedNeedle = caseInsensitive ? needle.toLowerCase() : needle;
    matcher = (line) => {
      const haystack = caseInsensitive ? line.toLowerCase() : line;
      return haystack.includes(normalizedNeedle);
    };
  }

  const input = createReadStream(filePath, { encoding: 'utf8' });
  const reader = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;

  try {
    for await (const line of reader) {
      lineNumber += 1;

      if (matcher(line)) {
        return {
          line,
          lineNumber,
        };
      }
    }
  } finally {
    reader.close();
    input.destroy();
  }

  return null;
}

function isBinaryBuffer(buffer) {
  if (!buffer.length) {
    return false;
  }

  if (buffer.includes(0)) {
    return true;
  }

  let suspicious = 0;

  for (const byte of buffer.subarray(0, Math.min(buffer.length, 4096))) {
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious += 1;
    }
  }

  return suspicious / Math.min(buffer.length, 4096) > 0.08;
}

function unpreviewableFile(reportPath, type, message) {
  return {
    path: reportPath,
    type,
    size: 0,
    previewable: false,
    binary: false,
    truncated: false,
    content: '',
    message,
  };
}

function countLines(content) {
  if (!content) {
    return 0;
  }

  return content.split(/\r?\n/).length;
}

function previewError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function inferArchiveType(filename) {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.zip')) {
    return 'zip';
  }

  if (
    lower.endsWith('.tar') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.xz') ||
    lower.endsWith('.txz') ||
    lower.endsWith('.tar.bz2') ||
    lower.endsWith('.tbz2') ||
    lower.endsWith('.tar.zst')
  ) {
    return 'tar';
  }

  return null;
}

export async function listArchiveEntries(archivePath, archiveType) {
  if (archiveType === 'zip') {
    const { stdout } = await runCommand('unzip', ['-Z1', archivePath]);
    return stdout.split('\n').filter(Boolean);
  }

  if (archiveType === 'tar') {
    const { stdout } = await runCommand('tar', ['-tf', archivePath]);
    return stdout.split('\n').filter(Boolean);
  }

  throw new Error(`Unsupported archive type: ${archiveType}`);
}

export function validateArchiveEntries(entries) {
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Archive has more than ${MAX_ARCHIVE_ENTRIES} entries.`);
  }

  for (const entry of entries) {
    validateArchiveEntryPath(entry);
  }
}

export function validateArchiveEntryPath(entryPath) {
  const normalized = entryPath.replaceAll('\\', '/');

  if (!normalized || normalized.includes('\0')) {
    throw new Error('Archive contains an invalid empty path.');
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`Archive contains an absolute path: ${entryPath}`);
  }

  const segments = normalized.split('/').filter(Boolean);

  if (!segments.length || segments.includes('..')) {
    throw new Error(`Archive contains an unsafe path: ${entryPath}`);
  }
}

async function extractArchive(archivePath, archiveType, extractDir, { maxExtractedBytes } = {}) {
  if (archiveType === 'zip') {
    await runCommandWithDirectoryQuota('unzip', ['-oq', archivePath, '-d', extractDir], {
      directory: extractDir,
      maxBytes: maxExtractedBytes,
    });
    return;
  }

  if (archiveType === 'tar') {
    await runCommandWithDirectoryQuota('tar', ['-xf', archivePath, '-C', extractDir], {
      directory: extractDir,
      maxBytes: maxExtractedBytes,
    });
    return;
  }

  throw new Error(`Unsupported archive type: ${archiveType}`);
}

async function expandNestedArchives(rootDir, { maxExtractedBytes, maxDepth = NESTED_ARCHIVE_MAX_DEPTH } = {}) {
  const processedArchives = new Set();

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const index = await buildFileIndex(rootDir);
    const archives = index.filter((entry) => entry.type === 'file' && inferArchiveType(entry.path));
    let expandedCount = 0;

    for (const entry of archives) {
      const archivePath = path.join(rootDir, entry.path);
      const archiveRealPath = await fs.realpath(archivePath);

      if (processedArchives.has(archiveRealPath)) {
        continue;
      }

      processedArchives.add(archiveRealPath);

      const archiveType = inferArchiveType(entry.path);
      const target = await nestedArchiveTarget(rootDir, entry.path);

      if (target.skipped) {
        continue;
      }

      if (target.alreadyExpanded) {
        continue;
      }

      let archiveEntries;

      try {
        archiveEntries = await listArchiveEntries(archivePath, archiveType);
        validateArchiveEntries(archiveEntries);
      } catch (error) {
        await writeNestedArchiveStatus(rootDir, entry.path, {
          status: 'skipped',
          reason: 'list-failed',
          message: error.message,
        });
        continue;
      }

      const remainingBytes = await remainingExtractionBudget(rootDir, maxExtractedBytes);

      if (remainingBytes <= 0) {
        await writeNestedArchiveStatus(rootDir, entry.path, {
          status: 'skipped',
          reason: 'budget-exhausted',
          message: `No extraction budget remains within the configured limit of ${maxExtractedBytes} bytes.`,
        });
        continue;
      }

      const targetDir = target.path;
      await fs.mkdir(targetDir, { recursive: true });

      try {
        await extractArchive(archivePath, archiveType, targetDir, {
          maxExtractedBytes: remainingBytes,
        });
      } catch (error) {
        await fs.rm(targetDir, { recursive: true, force: true });

        if (isExtractionQuotaError(error)) {
          await writeNestedArchiveStatus(rootDir, entry.path, {
            status: 'skipped',
            reason: 'quota-exceeded',
            message: error.message,
          });
          continue;
        }

        throw error;
      }

      if (Number.isFinite(maxExtractedBytes) && maxExtractedBytes > 0) {
        const totalBytes = await directorySize(rootDir);

        if (totalBytes > maxExtractedBytes) {
          await fs.rm(targetDir, { recursive: true, force: true });
          await writeNestedArchiveStatus(rootDir, entry.path, {
            status: 'skipped',
            reason: 'quota-exceeded',
            message: `Extracted data is larger than the configured limit of ${maxExtractedBytes} bytes.`,
          });
          continue;
        }
      }

      await writeNestedArchiveStatus(rootDir, entry.path, {
        status: 'expanded',
        targetPath: path.relative(rootDir, targetDir).replaceAll(path.sep, '/'),
        entryCount: archiveEntries.length,
      });
      expandedCount += 1;
    }

    if (!expandedCount) {
      return;
    }
  }
}

async function nestedArchiveTarget(rootDir, archiveReportPath) {
  const status = await readNestedArchiveStatus(rootDir, archiveReportPath);

  if (status?.status === 'skipped') {
    return {
      skipped: true,
      reason: status.reason,
    };
  }

  if (status?.status === 'expanded' && status.targetPath) {
    validateArchiveEntryPath(status.targetPath);
    const target = path.join(rootDir, status.targetPath);

    try {
      const stats = await fs.lstat(target);

      if (stats.isDirectory()) {
        return {
          path: target,
          alreadyExpanded: true,
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const baseTargetPath = stripArchiveSuffix(archiveReportPath);
  const candidatePaths = [
    baseTargetPath,
    `${baseTargetPath}.contents`,
    `${baseTargetPath}.contents-2`,
    `${baseTargetPath}.contents-3`,
  ];

  for (const candidatePath of candidatePaths) {
    validateArchiveEntryPath(candidatePath);
    const candidate = path.join(rootDir, candidatePath);

    try {
      await fs.lstat(candidate);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          path: candidate,
          alreadyExpanded: false,
        };
      }

      throw error;
    }
  }

  const fallbackPath = `${baseTargetPath}.contents-${Date.now()}`;
  validateArchiveEntryPath(fallbackPath);

  return {
    path: path.join(rootDir, fallbackPath),
    alreadyExpanded: false,
  };
}

async function remainingExtractionBudget(rootDir, maxExtractedBytes) {
  if (!Number.isFinite(maxExtractedBytes) || maxExtractedBytes <= 0) {
    return maxExtractedBytes;
  }

  const currentBytes = await directorySize(rootDir);
  return Math.max(0, maxExtractedBytes - currentBytes);
}

function isExtractionQuotaError(error) {
  return String(error?.message ?? '').includes('larger than the configured limit');
}

async function readNestedArchiveStatus(rootDir, archiveReportPath) {
  let content;

  try {
    content = await fs.readFile(nestedArchiveStatusPath(rootDir, archiveReportPath), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeNestedArchiveStatus(rootDir, archiveReportPath, status) {
  const statusPath = nestedArchiveStatusPath(rootDir, archiveReportPath);
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(
    statusPath,
    JSON.stringify({
      archivePath: archiveReportPath,
      updatedAt: new Date().toISOString(),
      ...status,
    }, null, 2),
    'utf8',
  );
}

function nestedArchiveStatusPath(rootDir, archiveReportPath) {
  const digest = crypto.createHash('sha1').update(String(archiveReportPath)).digest('hex');
  return path.join(rootDir, ANALYSIS_METADATA_DIRNAME, NESTED_ARCHIVE_STATUS_DIRNAME, `${digest}.json`);
}

function stripArchiveSuffix(reportPath) {
  return String(reportPath).replace(
    /(\.tar\.gz|\.tgz|\.tar\.xz|\.txz|\.tar\.bz2|\.tbz2|\.tar\.zst|\.tar|\.zip)$/i,
    '',
  );
}

async function buildFileIndex(rootDir) {
  const entries = [];

  async function walk(currentDir, relativeDir = '') {
    const children = await fs.readdir(currentDir, { withFileTypes: true });

    for (const child of children) {
      if (!relativeDir && child.name === ANALYSIS_METADATA_DIRNAME) {
        continue;
      }

      const absolutePath = path.join(currentDir, child.name);
      const relativePath = path.posix.join(relativeDir, child.name);
      const stats = await fs.lstat(absolutePath);

      if (child.isDirectory()) {
        entries.push({
          path: relativePath,
          type: 'directory',
          size: 0,
          mtime: stats.mtime.toISOString(),
        });
        await walk(absolutePath, relativePath);
        continue;
      }

      if (child.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          type: 'symlink',
          size: 0,
          mtime: stats.mtime.toISOString(),
        });
        continue;
      }

      entries.push({
        path: relativePath,
        type: 'file',
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        extension: path.extname(child.name).toLowerCase(),
      });
    }
  }

  await walk(rootDir);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function summarizeFileIndex(index) {
  const fileEntries = index.filter((entry) => entry.type === 'file');
  const directoryEntries = index.filter((entry) => entry.type === 'directory');
  const symlinkEntries = index.filter((entry) => entry.type === 'symlink');
  const totalBytes = fileEntries.reduce((sum, entry) => sum + entry.size, 0);

  return {
    totalEntries: index.length,
    fileCount: fileEntries.length,
    directoryCount: directoryEntries.length,
    symlinkCount: symlinkEntries.length,
    totalBytes,
    reportFileLimit: MAX_REPORT_FILE_ENTRIES,
    truncatedFileIndex: fileEntries.length > MAX_REPORT_FILE_ENTRIES,
  };
}

function summarizeTopLevelEntries(index) {
  const counts = new Map();

  for (const entry of index) {
    const [topLevel] = entry.path.split('/');
    counts.set(topLevel, (counts.get(topLevel) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 20);
}

function largestFiles(index, limit) {
  return index
    .filter((entry) => entry.type === 'file')
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .map((entry) => ({
      path: entry.path,
      size: entry.size,
    }));
}

async function runCommandWithDirectoryQuota(command, args, { directory, maxBytes }) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return runCommand(command, args);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let quotaExceeded = false;
    let quotaCheckRunning = false;
    let killTimer = null;

    const monitor = setInterval(async () => {
      if (quotaCheckRunning) {
        return;
      }

      quotaCheckRunning = true;

      try {
        const totalBytes = await directorySize(directory);

        if (totalBytes > maxBytes && !quotaExceeded) {
          quotaExceeded = true;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
          killTimer.unref?.();
        }
      } catch {
        // The extraction command may be creating or removing directories while
        // the monitor walks them. A later pass or the final index check will
        // catch the actual size.
      } finally {
        quotaCheckRunning = false;
      }
    }, 500);
    monitor.unref?.();

    child.stdout.on('data', (chunk) => {
      stdout = appendCommandOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendCommandOutput(stderr, chunk);
    });
    child.on('error', (error) => {
      clearInterval(monitor);
      clearTimeout(killTimer);
      reject(new Error(`Failed to run ${command}. ${error.message}`.trim()));
    });
    child.on('close', (code, signal) => {
      clearInterval(monitor);
      clearTimeout(killTimer);

      if (quotaExceeded) {
        reject(new Error(`Extracted data is larger than the configured limit of ${maxBytes} bytes.`));
        return;
      }

      if (code !== 0) {
        const suffix = stderr ? ` ${stderr}` : signal ? ` Process ended with signal ${signal}.` : '';
        reject(new Error(`Failed to run ${command}.${suffix}`.trim()));
        return;
      }

      directorySize(directory)
        .then((totalBytes) => {
          if (totalBytes > maxBytes) {
            reject(new Error(`Extracted data is larger than the configured limit of ${maxBytes} bytes.`));
            return;
          }

          resolve({ stdout, stderr });
        })
        .catch(reject);
    });
  });
}

async function runCommand(command, args) {
  try {
    return await execFileAsync(command, args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120000,
    });
  } catch (error) {
    const stderr = error.stderr ? ` ${error.stderr}` : '';
    throw new Error(`Failed to run ${command}.${stderr}`.trim());
  }
}

async function directorySize(rootDir) {
  let total = 0;

  async function walk(currentDir) {
    let children;

    try {
      children = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return;
      }

      throw error;
    }

    for (const child of children) {
      const absolutePath = path.join(currentDir, child.name);

      let stats;

      try {
        stats = await fs.lstat(absolutePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue;
        }

        throw error;
      }

      if (stats.isSymbolicLink()) {
        continue;
      }

      if (stats.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (stats.isFile()) {
        total += stats.size;
      }
    }
  }

  await walk(rootDir);
  return total;
}

function appendCommandOutput(output, chunk) {
  const next = output + chunk.toString();
  return next.length > 20 * 1024 ? next.slice(-20 * 1024) : next;
}
