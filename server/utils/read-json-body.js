const defaultMaxBytes = 64 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large');
    this.code = 'REQUEST_BODY_TOO_LARGE';
  }
}

export async function readJsonBody(request, options = {}) {
  const maxBytes = Number(options.maxBytes ?? defaultMaxBytes);
  const chunks = [];
  let byteLength = 0;

  for await (const chunk of request) {
    byteLength += Buffer.byteLength(chunk);

    if (byteLength > maxBytes) {
      throw new RequestBodyTooLargeError();
    }

    chunks.push(Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}
