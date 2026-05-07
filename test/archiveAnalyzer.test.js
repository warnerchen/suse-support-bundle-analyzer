import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferArchiveType,
  validateArchiveEntries,
  validateArchiveEntryPath,
} from '../src/analysis/archiveAnalyzer.js';

test('infers supported archive types for analysis', () => {
  assert.equal(inferArchiveType('support-bundle.zip'), 'zip');
  assert.equal(inferArchiveType('support-bundle.tar'), 'tar');
  assert.equal(inferArchiveType('support-bundle.tar.gz'), 'tar');
  assert.equal(inferArchiveType('support-bundle.tgz'), 'tar');
  assert.equal(inferArchiveType('support-bundle.tar.zst'), 'tar');
});

test('does not infer unsupported single-file compression as an archive', () => {
  assert.equal(inferArchiveType('support-bundle.gz'), null);
  assert.equal(inferArchiveType('support-bundle.txt'), null);
});

test('accepts safe archive paths', () => {
  assert.doesNotThrow(() => validateArchiveEntryPath('longhorn-system/manager.log'));
  assert.doesNotThrow(() => validateArchiveEntries(['bundle/nodes/node-1/events.yaml']));
});

test('rejects unsafe archive paths', () => {
  assert.throws(() => validateArchiveEntryPath('/etc/passwd'), /absolute path/);
  assert.throws(() => validateArchiveEntryPath('../outside'), /unsafe path/);
  assert.throws(() => validateArchiveEntryPath('bundle/../../outside'), /unsafe path/);
  assert.throws(() => validateArchiveEntryPath('C:\\Windows\\system32'), /absolute path/);
});
