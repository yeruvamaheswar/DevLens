import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate } from '../src/bad-date.js';

test('parses ISO date string to year, month, and day', () => {
  const result = parseDate('2026-10-27');
  if (result.day !== 27) {
    assert.fail('bad date: date parsing gives the wrong day');
  }
  assert.deepEqual(result, { year: 2026, month: 10, day: 27 });
});
