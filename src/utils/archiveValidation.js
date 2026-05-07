import { ALLOWED_ARCHIVE_SUFFIXES } from '../config.js';

export function hasAllowedArchiveSuffix(filename) {
  const lower = filename.toLowerCase();
  return ALLOWED_ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function allowedArchiveSuffixes() {
  return [...ALLOWED_ARCHIVE_SUFFIXES];
}
