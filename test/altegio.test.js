const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ALTEGIO_BEARER_TOKEN = 'partner';
process.env.ALTEGIO_USER_TOKEN = 'user';
process.env.ALTEGIO_MIN_INTERVAL_MS = '1';
process.env.ALTEGIO_MAX_RETRIES = '0';

const requestedUrls = [];
global.fetch = async (url) => {
  requestedUrls.push(url);
  const page = Number(new URL(url).searchParams.get('page'));
  const data = page === 1
    ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
    : [{ id: 101 }];
  return new Response(JSON.stringify({ success: true, data, meta: { total_count: 101 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const { fetchRecords } = require('../altegio');

test('records are fetched page by page until meta.total_count is reached', async () => {
  const records = await fetchRecords('123', '2026-08-14', '2026-08-14');

  assert.equal(records.length, 101);
  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]).searchParams.get('page'), '1');
  assert.equal(new URL(requestedUrls[1]).searchParams.get('page'), '2');
  assert.equal(new URL(requestedUrls[0]).searchParams.get('count'), '100');
});
