import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_EXTRACTED_BYTES,
  MAX_REPORT_FILE_ENTRIES,
} from '../config.js';
import { analyzeLonghornSupportBundle, detectLonghornVersion } from './longhornAnalyzer.js';

const execFileAsync = promisify(execFile);
const FILE_PREVIEW_MAX_BYTES = 512 * 1024;
const FILE_PREVIEW_CONTEXT_LINES = 80;
const FILE_PREVIEW_MAX_LINE_WINDOW = 220;

export class ArchiveAnalyzer {
  constructor({ workDir }) {
    this.workDir = workDir;
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
    await extractArchive(archivePath, archiveType, extractDir);

    await updateStage('indexing files');
    const index = await buildFileIndex(extractDir);
    const summary = summarizeFileIndex(index);

    if (summary.totalBytes > MAX_EXTRACTED_BYTES) {
      throw new Error(
        `Extracted data is larger than the configured limit of ${MAX_EXTRACTED_BYTES} bytes.`,
      );
    }

    await updateStage('running product checks');
    const productAnalysis = await analyzeProductBundle({
      productType: bundle.productType,
      extractDir,
      index,
    });

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
      inventory: productAnalysis.inventory,
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

  async readExtractedFile({ jobId, reportPath, lineStart = null, lineEnd = null, matchText = '' }) {
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

    const matchedLine = matchText ? await findMatchingLine(filePath, matchText) : null;
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

  async enrichExistingReport(report) {
    if (report.productType !== 'longhorn' || report.inventory?.longhorn?.version) {
      return report;
    }

    try {
      const extractDir = path.join(this.workDir, report.jobId, 'extracted');
      const index = await buildFileIndex(extractDir);
      const version = await detectLonghornVersion({ extractDir, index });

      if (!version) {
        return report;
      }

      return {
        ...report,
        inventory: {
          ...(report.inventory ?? {}),
          longhorn: {
            ...(report.inventory?.longhorn ?? {}),
            version,
          },
        },
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return report;
      }

      throw error;
    }
  }
}

async function analyzeProductBundle({ productType, extractDir, index }) {
  if (productType === 'longhorn') {
    return analyzeLonghornSupportBundle({ extractDir, index });
  }

  return {
    inventory: {},
    groupSummary: {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
    },
    findingGroups: [],
    findingSummary: {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
    },
    findings: [],
  };
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

async function findMatchingLine(filePath, matchText) {
  const needle = String(matchText ?? '').trim().replace(/\.\.\.$/, '').trim();

  if (needle.length < 16) {
    return null;
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

      if (line.includes(needle)) {
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

async function extractArchive(archivePath, archiveType, extractDir) {
  if (archiveType === 'zip') {
    await runCommand('unzip', ['-q', archivePath, '-d', extractDir]);
    return;
  }

  if (archiveType === 'tar') {
    await runCommand('tar', ['-xf', archivePath, '-C', extractDir]);
    return;
  }

  throw new Error(`Unsupported archive type: ${archiveType}`);
}

async function buildFileIndex(rootDir) {
  const entries = [];

  async function walk(currentDir, relativeDir = '') {
    const children = await fs.readdir(currentDir, { withFileTypes: true });

    for (const child of children) {
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
