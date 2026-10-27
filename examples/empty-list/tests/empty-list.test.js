import test from 'node:test';
import assert from 'node:assert/strict';
import { extractItemNames } from '../src/empty-list.js';

test('extracts item names or returns empty list for empty result', () => {
  let result;
  let thrown;
  try {
    result = extractItemNames({});
  } catch (err) {
    thrown = err;
  }

  if (thrown) {
    assert.fail('empty list: empty result crashes instead of returning an empty list');
  }
  assert.deepEqual(result, []);
});
