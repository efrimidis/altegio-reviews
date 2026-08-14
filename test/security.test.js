const test = require('node:test');
const assert = require('node:assert/strict');

const { matchesSecret, getBearerToken } = require('../security');

test('Bearer authorization is parsed and compared safely', () => {
  assert.equal(getBearerToken('Bearer correct-secret'), 'correct-secret');
  assert.equal(getBearerToken('bearer correct-secret'), 'correct-secret');
  assert.equal(getBearerToken('Basic abc'), null);
  assert.equal(matchesSecret('correct-secret', 'correct-secret'), true);
  assert.equal(matchesSecret('wrong', 'correct-secret'), false);
  assert.equal(matchesSecret(null, 'correct-secret'), false);
});
