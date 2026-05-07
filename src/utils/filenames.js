import path from 'node:path';

export function sanitizeFilename(filename) {
  const base = path.basename(filename || 'support-bundle');
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return sanitized || 'support-bundle';
}
