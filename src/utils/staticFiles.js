import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export async function serveStaticFile(request, response, publicDir) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const requestedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolvedPath = path.resolve(publicDir, safePath);
  const relative = path.relative(publicDir, resolvedPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403);
    response.end('Forbidden');
    return true;
  }

  try {
    const file = await fs.readFile(resolvedPath);
    const extension = path.extname(resolvedPath);

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': file.length,
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
    });
    response.end(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return false;
    }

    throw error;
  }
}
