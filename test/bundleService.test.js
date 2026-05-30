import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { File } from 'node:buffer';
import { BundleRepository } from '../src/repositories/bundleRepository.js';
import { BundleService } from '../src/services/bundleService.js';
import { NfsBundleStorage } from '../src/storage/nfsBundleStorage.js';

test('rejects duplicate bundle uploads for the same product and checksum', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-service-'));

  try {
    const metadataDir = path.join(rootDir, 'metadata');
    const storageDir = path.join(rootDir, 'bundles');
    const service = new BundleService({
      repository: new BundleRepository(metadataDir),
      storage: new NfsBundleStorage(storageDir, { createRoot: true }),
    });

    const first = await service.createFromFormData(bundleFormData('harvester', 'support-bundle.zip', 'same bundle'));

    await assert.rejects(
      () => service.createFromFormData(bundleFormData('harvester', 'support-bundle-copy.zip', 'same bundle')),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.details.code, 'duplicate_bundle');
        assert.equal(error.details.existingBundle.id, first.id);
        return true;
      },
    );

    const secondProduct = await service.createFromFormData(bundleFormData('longhorn', 'support-bundle.zip', 'same bundle'));
    const bundles = await service.listBundles();
    const storageEntries = await fs.readdir(storageDir);

    assert.equal(secondProduct.productType, 'longhorn');
    assert.equal(bundles.length, 2);
    assert.deepEqual(new Set(storageEntries), new Set([first.id, secondProduct.id]));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

function bundleFormData(productType, filename, content) {
  const formData = new FormData();
  formData.set('productType', productType);
  formData.set('bundleFile', new File([content], filename, { type: 'application/zip' }));
  return formData;
}
