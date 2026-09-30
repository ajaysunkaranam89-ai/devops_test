const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

let server;
let base;

before(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /health returns ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { status: 'ok' });
});

test('GET /api/info returns app metadata', async () => {
  const res = await fetch(`${base}/api/info`);
  const body = await res.json();
  assert.strictEqual(body.app, 'node-practice-app');
  assert.ok(body.hostname);
  assert.ok(typeof body.uptimeSeconds === 'number');
});

test('GET / serves the dashboard', async () => {
  const res = await fetch(`${base}/`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /DevOps Pipeline/);
});
