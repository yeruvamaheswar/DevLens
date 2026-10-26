import {test} from 'node:test';
import assert from 'node:assert/strict';
import {endpoint} from './client.js';
test('uses the correct base URL',()=>assert.equal(endpoint(),'https://example.invalid/api/health','wrong base URL: expected /api, received /v0'));
