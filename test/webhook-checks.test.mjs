// A check that has only ever passed is not a check. Every case below drives the real
// runWebhookChecks against a real local server, and the redirect case is the one that
// matters: it must FAIL, because in production it silently did not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runWebhookChecks } from '../src/checks/webhooks.mjs';

/** A server that reproduces both real-world shapes: a canonicalising 308 and a POST-only route. */
function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/redirecting/webhook') {
        // Exactly what textayo's apex and fullthrottle's www were doing.
        res.writeHead(308, { location: 'https://www.example.test/redirecting/webhook' });
        return res.end();
      }
      if (req.url === '/healthy/webhook') {
        // A POST-only handler answering GET, which is the healthy signature.
        res.writeHead(405);
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const byId = (results, id) => results.filter((r) => r.id === id);

test('FAILS on an endpoint whose host redirects (the production bug)', async () => {
  const { server, port } = await startServer();
  try {
    const results = await runWebhookChecks({
      webhookEndpoints: [{ name: 'redirecting', url: `http://127.0.0.1:${port}/redirecting/webhook` }],
    });
    const r = byId(results, 'webhook.no-redirect');
    assert.equal(r.length, 1);
    assert.equal(r[0].status, 'fail', 'a 308 endpoint MUST fail — this is the whole check');
    assert.match(r[0].evidence, /308/);
    assert.match(r[0].evidence, /www\.example\.test/, 'evidence must name the URL to register instead');
  } finally {
    server.close();
  }
});

test('PASSES a directly reachable POST-only handler', async () => {
  const { server, port } = await startServer();
  try {
    const results = await runWebhookChecks({
      webhookEndpoints: [`http://127.0.0.1:${port}/healthy/webhook`],
    });
    const r = byId(results, 'webhook.no-redirect');
    assert.equal(r.length, 1);
    assert.equal(r[0].status, 'pass', '405 on GET is a healthy POST-only route');
  } finally {
    server.close();
  }
});

test('FAILS a bare origin with no path (the fullthrottle bug)', async () => {
  const results = await runWebhookChecks({
    webhookEndpoints: [{ name: 'bare', url: 'https://www.fullthrottle.example/' }],
  });
  const r = byId(results, 'webhook.path');
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'fail');
  assert.match(r[0].evidence, /no path/);
});

test('FAILS an unparseable URL', async () => {
  const results = await runWebhookChecks({ webhookEndpoints: ['not a url'] });
  assert.equal(byId(results, 'webhook.url')[0].status, 'fail');
});

test('FAILS when the host does not answer at all', async () => {
  // Port 1 on loopback refuses immediately; this must be a fail, never a pass.
  const results = await runWebhookChecks({
    webhookEndpoints: [{ name: 'dead', url: 'http://127.0.0.1:1/webhook' }],
  });
  const r = byId(results, 'webhook.reachable');
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'fail');
});

test('SKIPS loudly when nothing is configured, and never reports a pass', async () => {
  const results = await runWebhookChecks({});
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'skip', 'an empty config must not look like a clean bill of health');
  assert.match(results[0].evidence, /no webhookEndpoints configured/);
});

test('a mixed set reports each endpoint independently', async () => {
  const { server, port } = await startServer();
  try {
    const results = await runWebhookChecks({
      webhookEndpoints: [
        { name: 'good', url: `http://127.0.0.1:${port}/healthy/webhook` },
        { name: 'bad', url: `http://127.0.0.1:${port}/redirecting/webhook` },
      ],
    });
    assert.equal(results.filter((r) => r.status === 'pass').length, 1);
    assert.equal(results.filter((r) => r.status === 'fail').length, 1);
    assert.equal(results.find((r) => r.status === 'fail').title, 'bad does not redirect');
  } finally {
    server.close();
  }
});
