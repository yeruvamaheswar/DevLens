import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAuthorizedRequest } from '../src/missing-auth.js';

test('includes Authorization header in request', async () => {
  let seenHeaders;
  const mockFetch = async (url, options = {}) => {
    seenHeaders = options.headers || {};
    return { ok: true, status: 200 };
  };

  await sendAuthorizedRequest('https://api.example.invalid/profile', 'secret-token', mockFetch);

  if (!seenHeaders.Authorization) {
    assert.fail('missing auth: request sends no Authorization header');
  }
  assert.equal(seenHeaders.Authorization, 'Bearer secret-token');
});
