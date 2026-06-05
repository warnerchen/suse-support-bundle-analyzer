import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../src/utils/logger.js';

test('writes structured log lines and respects log level', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));
  const logFile = path.join(tempDir, 'app.log');
  const consoleLines = [];
  const consoleSink = {
    log(line) {
      consoleLines.push(line);
    },
    warn(line) {
      consoleLines.push(line);
    },
    error(line) {
      consoleLines.push(line);
    },
  };

  try {
    const logger = createLogger({
      level: 'warn',
      filePath: logFile,
      context: {
        component: 'test',
      },
      consoleSink,
    });

    logger.info('ignored.event', { value: 1 });
    logger.warn('kept.event', { value: 2 });
    logger.error('error.event', { error: new Error('sample failure') });

    const records = (await fs.readFile(logFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.equal(records.length, 2);
    assert.equal(consoleLines.length, 2);
    assert.equal(records[0].event, 'kept.event');
    assert.equal(records[0].component, 'test');
    assert.equal(records[0].value, 2);
    assert.equal(records[1].event, 'error.event');
    assert.equal(records[1].error.message, 'sample failure');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
