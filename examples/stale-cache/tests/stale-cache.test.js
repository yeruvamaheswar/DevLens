import test from 'node:test';
import assert from 'node:assert/strict';
import { ValueCache } from '../src/stale-cache.js';

test('cache returns updated value after set', () => {
  const cache = new ValueCache();
  cache.set('key', 'initial');
  cache.set('key', 'updated');

  const val = cache.get('key');
  if (val === 'initial') {
    assert.fail('stale cache: cache returns old value after an update');
  }
  assert.equal(val, 'updated');
});
