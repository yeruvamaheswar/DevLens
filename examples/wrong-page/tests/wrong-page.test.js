import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPage } from '../src/wrong-page.js';

test('requests the requested page number', async () => {
  let requestedUrl = '';
  const mockFetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, status: 200 };
  };

  await fetchPage(2, mockFetch);

  if (requestedUrl.includes('page=1')) {
    assert.fail('wrong page: pagination asks for the wrong page number');
  }
  assert.equal(requestedUrl, 'https://api.example.invalid/items?page=2');
});
