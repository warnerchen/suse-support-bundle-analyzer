import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_EXTRACTED_BYTES,
  MAX_REPORT_FILE_ENTRIES,
} from '../config.js';

const execFileAsync = promisify(execFile);

export class ArchiveAnalyzer {
  constructor({ workDir }) {
    this.workDir = workDir;
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
      topLevelEntries: summarizeTopLevelEntries(index),
      largestFiles: largestFiles(index, 10),
      fileIndex: index
        .filter((entry) => entry.type === 'file')
        .slice(0, MAX_REPORT_FILE_ENTRIES),
      notes: [
        'This report is a safe extraction and file-index baseline. Product-specific analyzers can build on this job output.',
      ],
    };
  }
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
