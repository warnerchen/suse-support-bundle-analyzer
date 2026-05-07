import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAllowedArchiveSuffix } from '../src/utils/archiveValidation.js';
import { sanitizeFilename } from '../src/utils/filenames.js';

test('accepts common support bundle archive suffixes', () => {
  assert.equal(hasAllowedArchiveSuffix('longhorn-support-bundle.zip'), true);
  assert.equal(hasAllowedArchiveSuffix('harvester-support-bundle.tar.gz'), true);
  assert.equal(hasAllowedArchiveSuffix('supportbundle.tgz'), true);
  assert.equal(hasAllowedArchiveSuffix('support-bundle.tar.zst'), true);
});

test('rejects unsupported upload suffixes', () => {
  assert.equal(hasAllowedArchiveSuffix('notes.txt'), false);
  assert.equal(hasAllowedArchiveSuffix('bundle.zip.exe'), false);
});

test('sanitizes uploaded filenames', () => {
  assert.equal(sanitizeFilename('../../customer bundle.tar.gz'), 'customer_bundle.tar.gz');
  assert.equal(sanitizeFilename('support bundle (prod).zip'), 'support_bundle_prod_.zip');
});
