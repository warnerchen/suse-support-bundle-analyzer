import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { File } from 'node:buffer';
import { NfsBundleStorage } from '../src/storage/nfsBundleStorage.js';

test('stores bundle files under the configured NFS root', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suse-bundle-storage-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));

  const storage = new NfsBundleStorage(rootDir, { createRoot: true });
  const file = new File(['support bundle content'], 'bundle.tar.gz');
  const stored = await storage.putFile('test-id/bundle.tar.gz', file);

  assert.equal(stored.storageBackend, 'nfs');
  assert.equal(stored.storageRelativePath, 'test-id/bundle.tar.gz');
  assert.equal(stored.size, 22);

  const saved = await fs.readFile(path.join(rootDir, stored.storageRelativePath), 'utf8');
  assert.equal(saved, 'support bundle content');
});

test('rejects paths outside the configured NFS root', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suse-bundle-storage-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));

  const storage = new NfsBundleStorage(rootDir, { createRoot: true });
  const file = new File(['content'], 'bundle.tar.gz');

  await assert.rejects(
    () => storage.putFile('../bundle.tar.gz', file),
    /Invalid NFS storage path/,
  );
});

test('deletes a stored bundle directory under the configured NFS root', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suse-bundle-storage-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));

  const storage = new NfsBundleStorage(rootDir, { createRoot: true });
  const file = new File(['content'], 'bundle.tar.gz');
  await storage.putFile('delete-me/bundle.tar.gz', file);

  await storage.deleteDirectory('delete-me');

  await assert.rejects(() => fs.access(path.join(rootDir, 'delete-me')), /ENOENT/);
});
