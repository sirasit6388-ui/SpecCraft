import assert from 'node:assert/strict';
import test from 'node:test';

import { readJsonBody, RequestBodyTooLargeError } from '../utils/read-json-body.js';

test('readJsonBody parses a valid JSON request', async () => {
  const body = await readJsonBody(createRequest('{"budget":40000}'));

  assert.deepEqual(body, { budget: 40000 });
});

test('readJsonBody rejects malformed JSON', async () => {
  await assert.rejects(() => readJsonBody(createRequest('{invalid')), /valid JSON/);
});

test('readJsonBody rejects oversized requests before parsing', async () => {
  await assert.rejects(
    () => readJsonBody(createRequest('x'.repeat(65)), { maxBytes: 64 }),
    RequestBodyTooLargeError
  );
});

function createRequest(body) {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    }
  };
}
