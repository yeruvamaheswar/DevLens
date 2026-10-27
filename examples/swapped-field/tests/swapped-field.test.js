import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUserProfile } from '../src/swapped-field.js';

test('formats user profile with correct name and email fields', () => {
  const input = { id: 1, name: 'Ada', email: 'ada@example.com' };
  const result = formatUserProfile(input);

  if (result.name === input.email) {
    assert.fail('swapped fields: expected name "Ada", received email');
  }
  assert.deepEqual(result, { id: 1, name: 'Ada', email: 'ada@example.com' });
});
