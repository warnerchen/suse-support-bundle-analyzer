import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(currentDir, '..');
export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');
export const METADATA_DIR = process.env.METADATA_DIR
  ? path.resolve(process.env.METADATA_DIR)
  : path.join(DATA_DIR, 'metadata');
export const BUNDLE_STORAGE_DIR = process.env.BUNDLE_STORAGE_DIR
  ? path.resolve(process.env.BUNDLE_STORAGE_DIR)
  : path.join(DATA_DIR, 'bundles');
export const CREATE_BUNDLE_STORAGE_DIR = !process.env.BUNDLE_STORAGE_DIR;
export const ANALYSIS_WORK_DIR = process.env.ANALYSIS_WORK_DIR
  ? path.resolve(process.env.ANALYSIS_WORK_DIR)
  : path.join(DATA_DIR, 'work');
export const KB_STORAGE_DIR = process.env.KB_STORAGE_DIR
  ? path.resolve(process.env.KB_STORAGE_DIR)
  : path.join(DATA_DIR, 'kb');

export const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
export const HOST = process.env.HOST ?? '127.0.0.1';
export const MAX_UPLOAD_BYTES = Number.parseInt(
  process.env.MAX_UPLOAD_BYTES ?? String(1024 * 1024 * 1024),
  10,
);
export const MAX_ARCHIVE_ENTRIES = Number.parseInt(
  process.env.MAX_ARCHIVE_ENTRIES ?? '20000',
  10,
);
export const MAX_EXTRACTED_BYTES = Number.parseInt(
  process.env.MAX_EXTRACTED_BYTES ?? String(2 * 1024 * 1024 * 1024),
  10,
);
export const MAX_REPORT_FILE_ENTRIES = Number.parseInt(
  process.env.MAX_REPORT_FILE_ENTRIES ?? '5000',
  10,
);
export const KB_EMBEDDING_DIMENSIONS = Number.parseInt(
  process.env.KB_EMBEDDING_DIMENSIONS ?? '256',
  10,
);
export const KB_REMOTE_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.KB_REMOTE_FETCH_TIMEOUT_MS ?? '15000',
  10,
);
export const KB_REMOTE_IMPORT_LIMIT = Number.parseInt(
  process.env.KB_REMOTE_IMPORT_LIMIT ?? '80',
  10,
);
export const KB_TEXT_IMPORT_MAX_BYTES = Number.parseInt(
  process.env.KB_TEXT_IMPORT_MAX_BYTES ?? String(2 * 1024 * 1024),
  10,
);

export const PRODUCT_OPTIONS = [
  {
    value: 'longhorn',
    label: 'Longhorn',
    accent: '#0b7f4f',
  },
  {
    value: 'harvester',
    label: 'Harvester',
    accent: '#ce5a20',
  },
];

export const PRODUCT_TYPES = new Set(PRODUCT_OPTIONS.map((product) => product.value));

export const ALLOWED_ARCHIVE_SUFFIXES = [
  '.tar.gz',
  '.tar.xz',
  '.tar.bz2',
  '.tar.zst',
  '.tbz2',
  '.tgz',
  '.txz',
  '.zip',
  '.tar',
  '.gz',
];
