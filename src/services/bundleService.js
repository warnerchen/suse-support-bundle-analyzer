import crypto from 'node:crypto';
import path from 'node:path';
import { MAX_UPLOAD_BYTES, PRODUCT_TYPES } from '../config.js';
import { hasAllowedArchiveSuffix } from '../utils/archiveValidation.js';
import { sanitizeFilename } from '../utils/filenames.js';

export class BundleService {
  constructor({ repository, storage }) {
    this.repository = repository;
    this.storage = storage;
  }

  async listBundles() {
    return this.repository.list();
  }

  async getBundle(id) {
    return this.repository.findById(id);
  }

  async deleteBundle(id) {
    const bundle = await this.repository.findById(id);

    if (!bundle) {
      return null;
    }

    await this.storage.deleteDirectory(bundle.id);
    await this.repository.delete(id);

    return bundle;
  }

  async createFromFormData(formData) {
    const productType = String(formData.get('productType') ?? '').toLowerCase();
    const file = formData.get('bundleFile');

    if (!PRODUCT_TYPES.has(productType)) {
      throw validationError('Choose Longhorn or Harvester before uploading.');
    }

    if (!file || typeof file.stream !== 'function') {
      throw validationError('Select a support bundle archive to upload.');
    }

    const originalFilename = file.name || 'support-bundle';
    const storedFilename = sanitizeFilename(originalFilename);

    if (!hasAllowedArchiveSuffix(storedFilename)) {
      throw validationError('Upload a supported archive file.', {
        filename: originalFilename,
      });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      throw validationError('The selected file is larger than the upload limit.', {
        maxUploadBytes: MAX_UPLOAD_BYTES,
      });
    }

    const now = new Date();
    const id = crypto.randomUUID();
    const storageRelativePath = path.posix.join(id, storedFilename);
    const stored = await this.storage.putFile(storageRelativePath, file);
    const retentionUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const record = {
      id,
      productType,
      originalFilename,
      storedFilename,
      fileSize: stored.size,
      sha256: stored.sha256,
      storageBackend: stored.storageBackend,
      storageRelativePath: stored.storageRelativePath,
      uploadStatus: 'uploaded',
      createdAt: now.toISOString(),
      retentionUntil: retentionUntil.toISOString(),
    };

    return this.repository.save(record);
  }
}

function validationError(message, details = undefined) {
  const error = new Error(message);
  error.statusCode = 400;
  error.details = details;
  return error;
}
