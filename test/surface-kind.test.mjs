import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { goldenCoverage } from '../src/checks/surface-kind.mjs';
import { runRepoChecks } from '../src/checks/repo.mjs';
import { runGoldenSet } from '../src/checks/golden.mjs';

// Not every AI surface is the same kind of thing. (Mike, 2026-09-22: "it should know not
// every site is the same.") A surface that ANSWERS people must prove it declines outside its
// authority. A GUARD answers nobody: it only accepts or rejects content, so there is nothing
// for it to decline, and demanding an abstention case of it can only be met by writing a
// fake one. The Doctor now asks each surface what it is, and then checks that it is.

const trap = { id: 't', expect: 'json', trap: true, input: 'x', expect_fields: { accepted: false } };
const clean = { id: 'c', expect: 'json', input: 'y', expect_fields: { accepted: true } };
const refuse = { id: 'r', expect: 'refuse-and-point', input: 'odds?', pointTo: ['the tour'] };

describe('golden-set coverage depends on what the surface is', () => {
  test('an undeclared surface is held to the full rule, exactly as before', () => {
    assert.equal(goldenCoverage({ name: 's' }, [trap, clean]).ok, false);
    assert.equal(goldenCoverage({ name: 's' }, [trap, refuse]).ok, true);
  });

  test('an "answers" surface must decline as well as not fabricate', () => {
    assert.equal(goldenCoverage({ name: 's', kind: 'answers' }, [trap]).ok, false);
    assert.equal(goldenCoverage({ name: 's', kind: 'answers' }, [refuse]).ok, false);
  });

  test('a guard needs fabrication traps but no abstention case', () => {
    const r = goldenCoverage({ name: 'g', kind: 'guard', why: 'vets one generated line; answers nobody' }, [trap, clean]);
    assert.equal(r.ok, true, r.evidence);
  });

  test('a guard still needs a trap: the label never waives the no-fabrication rule', () => {
    assert.equal(goldenCoverage({ name: 'g', kind: 'guard', why: 'w' }, [clean]).ok, false);
  });

  test('a guard must say why it answers nobody', () => {
    const r = goldenCoverage({ name: 'g', kind: 'guard' }, [trap, clean]);
    assert.equal(r.ok, false);
    assert.match(r.evidence, /why/);
  });

  test('a "guard" whose cases are not structured verdicts is not a guard', () => {
    const r = goldenCoverage({ name: 'g', kind: 'guard', why: 'w' }, [trap, refuse]);
    assert.equal(r.ok, false);
    assert.match(r.evidence, /structured/);
  });

  test('a misspelt kind fails rather than quietly loosening the rule', () => {
    const r = goldenCoverage({ name: 's', kind: 'gaurd', why: 'w' }, [trap, clean]);
    assert.equal(r.ok, false);
    assert.match(r.evidence, /gaurd/);
  });
});

// The two places that count coverage (the repo check and the runner) must agree. They drifted
// once already (fb9b177); both now call goldenCoverage, and this proves they reach one answer.
describe('the repo check and the runner give the same verdict', () => {
  function fixture(surface, cases) {
    const root = mkdtempSync(join(tmpdir(), 'doctor-kind-'));
    mkdirSync(join(root, 'doctor'));
    writeFileSync(join(root, 'doctor/set.json'), JSON.stringify({ adapter: { type: 'module', path: './adapter.mjs' }, cases }));
    // The adapter IS the surface: a guard that returns a structured verdict for any input.
    writeFileSync(join(root, 'doctor/adapter.mjs'), 'export default async (input) => ({ text: JSON.stringify({ accepted: input === "y" }) });');
    return { root, cfg: { aiSurfaces: [{ ...surface, goldenSet: 'doctor/set.json' }] } };
  }
  const repoVerdict = (root, cfg) => runRepoChecks(root, cfg).find((r) => r.id === 'repo.golden-set').status;
  const runnerVerdict = async (root, cfg) =>
    (await runGoldenSet(root, cfg.aiSurfaces[0], cfg)).find((r) => r.id === 'eval.coverage').status;

  test('a declared guard passes both', async () => {
    const { root, cfg } = fixture({ name: 'g', kind: 'guard', why: 'vets a line' }, [trap, clean]);
    assert.equal(repoVerdict(root, cfg), 'pass');
    assert.equal(await runnerVerdict(root, cfg), 'pass');
  });

  test('the same set undeclared fails both', async () => {
    const { root, cfg } = fixture({ name: 'g' }, [trap, clean]);
    assert.equal(repoVerdict(root, cfg), 'fail');
    assert.equal(await runnerVerdict(root, cfg), 'fail');
  });

  test('a guard that returns free text fails its cases at run time', async () => {
    const { root, cfg } = fixture({ name: 'g', kind: 'guard', why: 'w' }, [trap, clean]);
    writeFileSync(join(root, 'doctor/adapter.mjs'), 'export default async () => ({ text: "Sure! Here is my answer." });');
    const results = await runGoldenSet(root, cfg.aiSurfaces[0], cfg);
    assert.ok(results.filter((r) => r.id === 'eval.json').every((r) => r.status === 'fail'));
  });
});
