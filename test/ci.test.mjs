import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate as evalSeam2, modelsIn, fieldsOf } from '../src/seam/invariants/seam2-schema.mjs';
import { evaluate as evalSeam3 } from '../src/seam/invariants/seam3-sdk.mjs';
import { evaluate as evalSeam4 } from '../src/seam/invariants/seam4-hosts.mjs';
import { evaluate as evalSig3 } from '../src/seam/invariants/sig3-unread.mjs';
import { evaluate as evalSec2 } from '../src/seam/invariants/sec2-fallback.mjs';

const SCHEMA = `
model User {
  id        String @id
  siteId    String
  email     String
}

model CrmContact {
  id     String @id
  siteId String
  site   Site   @relation(fields: [siteId], references: [id])
  name   String
}
`;

describe('SEAM-2 — schema owner vs riders', () => {
  test('models are parsed in order', () => {
    assert.deepEqual(modelsIn(SCHEMA), ['User', 'CrmContact']);
  });
  test('fields of one model are parsed', () => {
    assert.deepEqual(fieldsOf(SCHEMA, 'CrmContact'), ['id', 'siteId', 'site', 'name']);
  });
  test('an absent model yields no fields rather than throwing', () => {
    assert.deepEqual(fieldsOf(SCHEMA, 'Nope'), []);
  });

  test('a matching rider passes', () => {
    const r = evalSeam2({ pairs: [{ owner: 'o', rider: 'r', ownerModels: ['A','B'], riderModels: ['A','B'], fieldDrift: [] }] });
    assert.equal(r.status, 'pass');
  });
  test('a rider missing models fails and counts them', () => {
    const r = evalSeam2({ pairs: [{ owner: 'o', rider: 'r', ownerModels: ['A','B','C'], riderModels: ['A'], fieldDrift: [] }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /2 models behind/);
  });
  // THE REGRESSION this exists for: a dropped tenant key on a shared multi-tenant table.
  test('a rider that dropped a tenant column fails even with every model present', () => {
    const r = evalSeam2({ pairs: [{
      owner: 'nikkimike', rider: 'textayo', ownerModels: ['CrmContact'], riderModels: ['CrmContact'],
      fieldDrift: [{ model: 'CrmContact', missing: ['siteId', 'site'] }],
    }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /CrmContact.siteId/);
  });
  test('no pairs configured skips rather than passing', () => {
    assert.equal(evalSeam2({ pairs: [] }).status, 'skip');
  });
});

describe('SEAM-3 — one build per package', () => {
  test('identical copies pass', () => {
    const r = evalSeam3({ packages: [{ name: 'sdk', copies: [{ path: 'a', sha: 'x' }, { path: 'b', sha: 'x' }] }] });
    assert.equal(r.status, 'pass');
  });
  // Two tarballs sharing a VERSION but differing in bytes is the exact production state.
  test('two distinct builds of one package fails', () => {
    const r = evalSeam3({ packages: [{ name: 'identity-sdk', copies: [{ path: 'a', sha: 'x' }, { path: 'b', sha: 'y' }, { path: 'c', sha: 'y' }] }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /2 distinct builds across 3 copies/);
  });
  test('no vendored packages skips', () => {
    assert.equal(evalSeam3({ packages: [] }).status, 'skip');
  });
});

describe('SEAM-4 — hosts baked into source', () => {
  test('all answering passes', () => {
    assert.equal(evalSeam4({ hosts: [{ url: 'https://a', status: 200, sources: ['x.ts'] }] }).status, 'pass');
  });
  test('a 404 default is dead and names who dials it', () => {
    const r = evalSeam4({ hosts: [
      { url: 'https://memory.mrbrix.com', status: 404, sources: ['mrbrix-ayo/src/lib/grammar/voice-match.ts'] },
      { url: 'https://ok', status: 200, sources: ['y.ts'] },
    ] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /memory.mrbrix.com \(404\)/);
    assert.match(r.evidence, /voice-match.ts/);
  });
  test('no response counts as dead', () => {
    assert.equal(evalSeam4({ hosts: [{ url: 'https://x', status: 0, sources: ['a'] }] }).status, 'fail');
  });
  // If the probe failed entirely, do not declare every service host dead.
  test('an unmeasured probe skips', () => {
    assert.equal(evalSeam4({ hosts: [] }).status, 'skip');
  });
});

describe('SIG-3 — written but never read', () => {
  test('a store with readers passes', () => {
    assert.equal(evalSig3({ stores: [{ table: 't1_event', writes: 1, reads: 4 }] }).status, 'pass');
  });
  test('a write-only store fails', () => {
    const r = evalSig3({ stores: [{ table: 't1_pulse', writes: 1, reads: 0, rows: 11946 }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /t1_pulse: 1 write site\(s\), 0 reads, 11946 rows/);
  });
  test('a store that is read but never written is not this check’s business', () => {
    assert.equal(evalSig3({ stores: [{ table: 'sites', writes: 0, reads: 9 }] }).status, 'pass');
  });
  test('no stores skips', () => {
    assert.equal(evalSig3({ stores: [] }).status, 'skip');
  });
});

describe('SEC-2 — a shared secret with two owners', () => {
  test('no fallbacks passes', () => {
    assert.equal(evalSec2({ sites: [], filesScanned: 3000 }).status, 'pass');
  });
  // The exact pattern that produced a confidently wrong diagnosis.
  test('a shared secret falling back to a local one fails', () => {
    const r = evalSec2({ filesScanned: 3000, sites: [
      { file: 'nikkimike/src/lib/connectors/crypto.ts', line: 9, expression: 'process.env.CONNECTOR_ENC_KEY || process.env.JWT_SECRET' },
    ] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /crypto.ts:9/);
    assert.match(r.fix, /agree by coincidence/);
  });
  test('scanning nothing skips rather than reporting all clear', () => {
    assert.equal(evalSec2({ sites: [], filesScanned: 0 }).status, 'skip');
  });
});
