import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseMultipartForm } from '../src/utils/requestForm.js';

test('parses multipart fields and files across chunk boundaries', async () => {
  const boundary = '----support-bundle-analyzer-test-boundary';
  const body = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="productType"',
      '',
      'longhorn',
      `--${boundary}`,
      'Content-Disposition: form-data; name="bundleFile"; filename="support-bundle.zip"',
      'Content-Type: application/zip',
      '',
      'support bundle content',
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  );
  const formData = await parseMultipartForm(chunkedRequest(body, boundary, [7, 13, 5, 29]), {
    maxBytes: 1024 * 1024,
    maxFileBytes: 1024 * 1024,
  });

  try {
    const file = formData.get('bundleFile');

    assert.equal(formData.get('productType'), 'longhorn');
    assert.equal(file.name, 'support-bundle.zip');
    assert.equal(file.type, 'application/zip');
    assert.equal(file.size, 'support bundle content'.length);
    assert.equal(await file.text(), 'support bundle content');
  } finally {
    await formData.cleanup();
  }
});

test('rejects multipart files above the configured limit', async () => {
  const boundary = '----support-bundle-analyzer-limit-test';
  const body = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="bundleFile"; filename="support-bundle.zip"',
      'Content-Type: application/zip',
      '',
      'too large',
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  );

  await assert.rejects(
    () =>
      parseMultipartForm(chunkedRequest(body, boundary, [body.length]), {
        maxBytes: 1024,
        maxFileBytes: 3,
      }),
    (error) => {
      assert.equal(error.statusCode, 413);
      assert.match(error.message, /larger than the configured limit/);
      return true;
    },
  );
});

function chunkedRequest(body, boundary, chunkSizes) {
  const chunks = [];
  let offset = 0;

  for (const size of chunkSizes) {
    if (offset >= body.length) {
      break;
    }

    chunks.push(body.subarray(offset, offset + size));
    offset += size;
  }

  if (offset < body.length) {
    chunks.push(body.subarray(offset));
  }

  const request = Readable.from(chunks);
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };

  return request;
}
