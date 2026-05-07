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

export const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
export const HOST = process.env.HOST ?? '127.0.0.1';
export const MAX_UPLOAD_BYTES = Number.parseInt(
  process.env.MAX_UPLOAD_BYTES ?? String(1024 * 1024 * 1024),
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
