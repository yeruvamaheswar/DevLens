import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCurrentUser } from '../src/client.js';

// The client reads this token from a module-level `sessionToken` constant in src/client.js.
const sessionToken = 'session';

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? '';
  }
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === want) return String(value);
  }
  return '';
}

function recordedResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

test('loads the current user', async () => {
  const seen = { url: '', headers: undefined };
  const fetchImpl = async (url, init = {}) => {
    seen.url = String(url);
    seen.headers = init.headers;
    const urlOk = seen.url === 'https://example.invalid/api/users/me';
    const authOk = headerValue(init.headers, 'authorization') === `Bearer ${sessionToken}`;
    if (!urlOk) return recordedResponse(404, 'not found');
    if (!authOk) return recordedResponse(401, 'unauthorized');
    return recordedResponse(200, { id: 'user_1', name: 'Ada Lovelace' });
  };

  let result;
  let thrown;
  try {
    result = await fetchCurrentUser(fetchImpl);
  } catch (error) {
    thrown = error;
  }

  if (seen.url !== 'https://example.invalid/api/users/me') {
    assert.fail('wrong base URL: expected /api, received /v0');
  }
  if (headerValue(seen.headers, 'authorization') !== `Bearer ${sessionToken}`) {
    assert.fail('expected Authorization header');
  }
  if (thrown) throw thrown;
  assert.deepEqual(result, { id: 'user_1', name: 'Ada Lovelace' });
});
