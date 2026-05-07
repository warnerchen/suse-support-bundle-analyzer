import { Readable } from 'node:stream';

export async function parseMultipartForm(request) {
  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.url, `http://${host}`);

  const formRequest = new Request(url, {
    method: request.method,
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: 'half',
  });

  return formRequest.formData();
}
