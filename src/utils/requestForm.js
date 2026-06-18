import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = DEFAULT_MAX_BYTES;
const DEFAULT_MAX_FIELD_BYTES = 256 * 1024;
const DEFAULT_MAX_HEADER_BYTES = 16 * 1024;
const DEFAULT_MAX_PARTS = 128;

export async function parseMultipartForm(request, options = {}) {
  const boundary = parseBoundary(request.headers['content-type'] ?? '');
  const parser = new MultipartParser({
    boundary,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxFieldBytes: options.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES,
    maxHeaderBytes: options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES,
    maxParts: options.maxParts ?? DEFAULT_MAX_PARTS,
    tempDir: options.tempDir ?? path.join(os.tmpdir(), 'suse-support-bundle-analyzer-uploads'),
  });

  try {
    for await (const chunk of request) {
      await parser.write(Buffer.from(chunk));
    }

    return await parser.end();
  } catch (error) {
    await parser.cleanup();
    throw error;
  }
}

class MultipartParser {
  constructor({ boundary, maxBytes, maxFileBytes, maxFieldBytes, maxHeaderBytes, maxParts, tempDir }) {
    this.boundary = boundary;
    this.boundaryLine = Buffer.from(`--${boundary}`);
    this.bodyBoundary = Buffer.from(`\r\n--${boundary}`);
    this.maxBytes = maxBytes;
    this.maxFileBytes = maxFileBytes;
    this.maxFieldBytes = maxFieldBytes;
    this.maxHeaderBytes = maxHeaderBytes;
    this.maxParts = maxParts;
    this.tempDir = tempDir;
    this.formData = new ParsedFormData();
    this.buffer = Buffer.alloc(0);
    this.state = 'boundary';
    this.totalBytes = 0;
    this.partCount = 0;
    this.currentPart = null;
  }

  async write(chunk) {
    this.totalBytes += chunk.length;

    if (this.totalBytes > this.maxBytes) {
      throw multipartError(413, 'Multipart body is larger than the configured limit.');
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    await this.#process();
  }

  async end() {
    await this.#process({ eof: true });

    if (this.state !== 'done') {
      throw multipartError(400, 'Multipart body ended before the final boundary.');
    }

    return this.formData;
  }

  async cleanup() {
    await this.currentPart?.cleanup?.();
    await this.formData.cleanup();
  }

  async #process({ eof = false } = {}) {
    while (true) {
      if (this.state === 'done') {
        return;
      }

      if (this.state === 'boundary') {
        if (!this.#consumeInitialBoundary(eof)) {
          return;
        }
        continue;
      }

      if (this.state === 'headers') {
        if (!(await this.#consumeHeaders())) {
          return;
        }
        continue;
      }

      if (this.state === 'body') {
        if (!(await this.#consumeBody())) {
          return;
        }
        continue;
      }

      throw multipartError(400, 'Multipart parser entered an invalid state.');
    }
  }

  #consumeInitialBoundary(eof) {
    const boundaryIndex = this.buffer.indexOf(this.boundaryLine);

    if (boundaryIndex === -1) {
      if (eof || this.buffer.length > this.boundaryLine.length + 4) {
        throw multipartError(400, 'Multipart boundary was not found.');
      }

      return false;
    }

    const afterBoundary = boundaryIndex + this.boundaryLine.length;

    if (this.buffer.length < afterBoundary + 2) {
      return false;
    }

    const suffix = this.buffer.subarray(afterBoundary, afterBoundary + 2).toString('latin1');

    if (suffix === '--') {
      this.buffer = this.buffer.subarray(afterBoundary + 2);
      this.state = 'done';
      return true;
    }

    if (suffix !== '\r\n') {
      throw multipartError(400, 'Multipart boundary has an invalid suffix.');
    }

    this.buffer = this.buffer.subarray(afterBoundary + 2);
    this.state = 'headers';
    return true;
  }

  async #consumeHeaders() {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');

    if (headerEnd === -1) {
      if (this.buffer.length > this.maxHeaderBytes) {
        throw multipartError(400, 'Multipart part headers are too large.');
      }

      return false;
    }

    const headerBlock = this.buffer.subarray(0, headerEnd).toString('latin1');
    this.buffer = this.buffer.subarray(headerEnd + 4);
    this.currentPart = await this.#startPart(headerBlock);
    this.state = 'body';
    return true;
  }

  async #consumeBody() {
    const boundaryIndex = this.buffer.indexOf(this.bodyBoundary);

    if (boundaryIndex === -1) {
      const retainBytes = Math.max(this.bodyBoundary.length - 1, 0);
      const writableBytes = this.buffer.length - retainBytes;

      if (writableBytes > 0) {
        await this.currentPart.write(this.buffer.subarray(0, writableBytes));
        this.buffer = this.buffer.subarray(writableBytes);
        return true;
      }

      return false;
    }

    if (this.buffer.length < boundaryIndex + this.bodyBoundary.length + 2) {
      return false;
    }

    await this.currentPart.write(this.buffer.subarray(0, boundaryIndex));
    await this.currentPart.finish();
    this.currentPart = null;
    this.buffer = this.buffer.subarray(boundaryIndex + this.bodyBoundary.length);

    if (this.buffer.length < 2) {
      return false;
    }

    const suffix = this.buffer.subarray(0, 2).toString('latin1');

    if (suffix === '--') {
      this.buffer = this.buffer.subarray(2);
      this.state = 'done';
      return true;
    }

    if (suffix !== '\r\n') {
      throw multipartError(400, 'Multipart boundary has an invalid part separator.');
    }

    this.buffer = this.buffer.subarray(2);
    this.state = 'headers';
    return true;
  }

  async #startPart(headerBlock) {
    this.partCount += 1;

    if (this.partCount > this.maxParts) {
      throw multipartError(413, 'Multipart body contains too many parts.');
    }

    const headers = parsePartHeaders(headerBlock);
    const disposition = parseContentDisposition(headers.get('content-disposition') ?? '');
    const name = disposition.name;

    if (!name) {
      throw multipartError(400, 'Multipart part is missing a form field name.');
    }

    if (Object.hasOwn(disposition, 'filename')) {
      return DiskFilePart.create({
        formData: this.formData,
        name,
        filename: disposition.filename || 'upload',
        type: headers.get('content-type') ?? '',
        maxFileBytes: this.maxFileBytes,
        tempDir: this.tempDir,
      });
    }

    return new FieldPart({
      formData: this.formData,
      name,
      maxFieldBytes: this.maxFieldBytes,
    });
  }
}

class FieldPart {
  constructor({ formData, name, maxFieldBytes }) {
    this.formData = formData;
    this.name = name;
    this.maxFieldBytes = maxFieldBytes;
    this.size = 0;
    this.chunks = [];
  }

  async write(chunk) {
    this.size += chunk.length;

    if (this.size > this.maxFieldBytes) {
      throw multipartError(413, `Form field ${this.name} is larger than the configured limit.`);
    }

    this.chunks.push(chunk);
  }

  async finish() {
    this.formData.append(this.name, Buffer.concat(this.chunks).toString('utf8'));
  }
}

class DiskFilePart {
  static async create({ formData, name, filename, type, maxFileBytes, tempDir }) {
    await fsPromises.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `${process.pid}-${Date.now()}-${crypto.randomUUID()}.upload`);

    return new DiskFilePart({
      formData,
      name,
      filename,
      type,
      maxFileBytes,
      tempPath,
    });
  }

  constructor({ formData, name, filename, type, maxFileBytes, tempPath }) {
    this.formData = formData;
    this.name = name;
    this.filename = filename;
    this.type = type;
    this.maxFileBytes = maxFileBytes;
    this.tempPath = tempPath;
    this.size = 0;
    this.writeError = null;
    this.writeStream = fs.createWriteStream(tempPath, { flags: 'wx' });
    this.writeStream.on('error', (error) => {
      this.writeError = error;
    });
  }

  async write(chunk) {
    if (!chunk.length) {
      return;
    }

    this.size += chunk.length;

    if (this.size > this.maxFileBytes) {
      throw multipartError(413, `Uploaded file ${this.filename} is larger than the configured limit.`);
    }

    if (this.writeError) {
      throw this.writeError;
    }

    if (!this.writeStream.write(chunk)) {
      await waitForDrain(this.writeStream);
    }

    if (this.writeError) {
      throw this.writeError;
    }
  }

  async finish() {
    if (this.writeError) {
      throw this.writeError;
    }

    await new Promise((resolve, reject) => {
      this.writeStream.once('finish', resolve);
      this.writeStream.once('error', reject);
      this.writeStream.end();
    });

    if (this.writeError) {
      throw this.writeError;
    }

    this.formData.append(
      this.name,
      new TempUploadFile({
        name: this.filename,
        type: this.type,
        size: this.size,
        tempPath: this.tempPath,
      }),
    );
  }

  async cleanup() {
    this.writeStream.destroy();
    await fsPromises.rm(this.tempPath, { force: true });
  }
}

class TempUploadFile {
  constructor({ name, type, size, tempPath }) {
    this.name = name;
    this.type = type;
    this.size = size;
    this.tempPath = tempPath;
  }

  stream() {
    return Readable.toWeb(fs.createReadStream(this.tempPath));
  }

  async text() {
    return fsPromises.readFile(this.tempPath, 'utf8');
  }

  async arrayBuffer() {
    const buffer = await fsPromises.readFile(this.tempPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  async cleanup() {
    await fsPromises.rm(this.tempPath, { force: true });
  }
}

class ParsedFormData {
  constructor() {
    this.items = [];
  }

  append(name, value) {
    this.items.push({ name, value });
  }

  get(name) {
    return this.items.find((item) => item.name === name)?.value ?? null;
  }

  getAll(name) {
    return this.items.filter((item) => item.name === name).map((item) => item.value);
  }

  async cleanup() {
    await Promise.all(
      this.items
        .map((item) => item.value)
        .filter((value) => typeof value?.cleanup === 'function')
        .map((value) => value.cleanup()),
    );
  }
}

function parseBoundary(contentType) {
  const match = String(contentType).match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim();

  if (!boundary) {
    throw multipartError(400, 'Multipart request is missing a boundary.');
  }

  return boundary;
}

function parsePartHeaders(headerBlock) {
  const headers = new Map();

  for (const line of headerBlock.split('\r\n')) {
    const separator = line.indexOf(':');

    if (separator === -1) {
      continue;
    }

    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  return headers;
}

function parseContentDisposition(value) {
  const result = {};

  for (const segment of value.split(';').slice(1)) {
    const separator = segment.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const key = segment.slice(0, separator).trim().toLowerCase();
    const rawValue = segment.slice(separator + 1).trim();
    result[key] = unquoteHeaderValue(rawValue);
  }

  return result;
}

function unquoteHeaderValue(value) {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
}

function multipartError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function waitForDrain(stream) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}
