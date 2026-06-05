import fs from 'node:fs';
import path from 'node:path';
import { LOG_FILE, LOG_LEVEL } from '../config.js';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  off: Number.POSITIVE_INFINITY,
};

export const logger = createLogger({
  level: LOG_LEVEL,
  filePath: LOG_FILE,
});

export function createLogger({ level = 'info', filePath = '', context = {}, consoleSink = console } = {}) {
  const normalizedLevel = String(level).toLowerCase();
  const minLevel = LEVELS[normalizedLevel] ?? LEVELS.info;
  const normalizedFilePath = filePath ? path.resolve(filePath) : '';

  if (normalizedFilePath) {
    fs.mkdirSync(path.dirname(normalizedFilePath), { recursive: true });
  }

  function write(levelName, event, fields = {}) {
    if (LEVELS[levelName] < minLevel) {
      return;
    }

    const record = {
      timestamp: new Date().toISOString(),
      level: levelName,
      event,
      ...context,
      ...normalizeFields(fields),
    };
    const line = `${JSON.stringify(record)}\n`;

    if (normalizedFilePath) {
      fs.appendFileSync(normalizedFilePath, line, 'utf8');
    }

    const text = line.trimEnd();

    if (levelName === 'error') {
      consoleSink.error(text);
    } else if (levelName === 'warn') {
      consoleSink.warn(text);
    } else {
      consoleSink.log(text);
    }
  }

  return {
    debug(event, fields) {
      write('debug', event, fields);
    },
    info(event, fields) {
      write('info', event, fields);
    },
    warn(event, fields) {
      write('warn', event, fields);
    },
    error(event, fields) {
      write('error', event, fields);
    },
    child(childContext = {}) {
      return createLogger({
        level: normalizedLevel,
        filePath: normalizedFilePath,
        context: {
          ...context,
          ...childContext,
        },
        consoleSink,
      });
    },
  };
}

function normalizeFields(fields) {
  const normalized = {};

  for (const [key, value] of Object.entries(fields ?? {})) {
    normalized[key] = normalizeValue(value);
  }

  return normalized;
}

function normalizeValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      statusCode: value.statusCode,
      details: value.details,
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]));
  }

  return value;
}
