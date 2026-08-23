import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { pass, fail, requireSample, result } from '../src/seam/contract.mjs';
import { verdictOf, exitCodeOf, toBool, parseJsonRows, asJsonQuery, runSeamDoctor } from '../src/seam/run.mjs';
import { tryDecrypt, evaluate as evalSeam1, measure as measSeam1 } from '../src/seam/invariants/seam1-decrypt.mjs';
import { evaluate as evalSig1, measure as measSig1 } from '../src/seam/invariants/sig1-emission.mjs';
import { evaluate as evalSig2, measure as measSig2 } from '../src/seam/invariants/sig2-sync.mjs';
import { evaluate as evalSig4, measure as measSig4 } from '../src/seam/invariants/sig4-freshness.mjs';
import { evaluate as evalSig5 } from '../src/seam/invariants/sig5-runlog.mjs';

const HOUR = 3600, DAY = 86400;
function encrypt(obj, secret) {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

describe('contract', () => {
  test('a pass without evidence is rejected', () => {
    assert.throws(() => pass({ id: 'X', title: 't', scope: 's' }), /evidence is required/);
  });
  test('a failure without a fix is rejected', () => {
    assert.throws(() => fail({ id: 'X', title: 't', scope: 's', evidence: 'e' }), /must name its fix/);
  });
  test('an unknown status is rejected so it cannot vanish from the roll-up', () => {
    assert.throws(() => result({ id: 'X', title: 't', status: 'banana', evidence: 'e' }), /unknown status/);
  });
  test('an empty sample SKIPS, it never passes', () => {
    assert.equal(requireSample(0, { id: 'X', title: 't', scope: 's', what: 'rows' }).status, 'skip');
  });
  test('an unmeasured sample skips too', () => {
    assert.equal(requireSample(undefined, { id: 'X', title: 't', scope: 's', what: 'r' }).status, 'skip');
  });
});

describe('roll-up — a skip is not a pass', () => {
  // THE REGRESSION: five skips previously reported PASS and exited 0.
  test('any skip makes the run INCOMPLETE, never pass', () => {
    assert.equal(verdictOf([{ status: 'pass' }, { status: 'skip' }]), 'incomplete');
  });
  test('a fail outranks a skip', () => {
    assert.equal(verdictOf([{ status: 'skip' }, { status: 'fail' }]), 'fail');
  });
  test('all passing is a pass', () => {
    assert.equal(verdictOf([{ status: 'pass' }, { status: 'pass' }]), 'pass');
  });
  test('an empty run is incomplete, not a pass', () => {
    assert.equal(verdictOf([]), 'incomplete');
  });
  test('incomplete does not exit 0', () => {
    assert.equal(exitCodeOf('pass'), 0);
    assert.equal(exitCodeOf('fail'), 1);
    assert.equal(exitCodeOf('incomplete'), 2);
    assert.notEqual(exitCodeOf('incomplete'), 0);
  });
  test('a runner over an empty database reports incomplete, not pass', async () => {
    const r = await runSeamDoctor({ runner: 't1', query: async () => [], secrets: {} });
    assert.equal(r.verdict, 'incomplete');
    assert.notEqual(r.verdict, 'pass');
  });
  test('a check whose measurement throws becomes a FAIL, not a silent absence', async () => {
    const r = await runSeamDoctor({
      runner: 't1', secrets: { connectorEncKey: 'k' },
      query: async () => { throw new Error('connection refused'); },
    }, { only: ['SIG-2'] });
    assert.equal(r.counts.fail, 1);
    assert.match(r.results[0].evidence, /could not run/);
  });
});

describe('query plumbing', () => {
  test('queries are wrapped so Postgres returns one JSON line', () => {
    assert.match(asJsonQuery('select a from b'), /json_agg/);
  });
  // THE REGRESSION: newline-splitting fabricated rows from a multi-line error column.
  test('a value containing newlines does not fabricate rows', () => {
    const rows = parseJsonRows(JSON.stringify([
      { name: 'A', last_error: null },
      { name: 'B', last_error: 'Error: boom\n    at Object.<anonymous> (/app/x.js:1:1)' },
    ]));
    assert.equal(rows.length, 2, 'a stack trace must not become a third row');
    assert.equal(rows[1].name, 'B');
  });
  test('real types survive, so booleans are booleans', () => {
    const rows = parseJsonRows(JSON.stringify([{ is_active: false, n: 3 }]));
    assert.equal(rows[0].is_active, false);
    assert.equal(rows[0].n, 3);
  });
  test('empty output is an empty array, not a crash', () => {
    assert.deepEqual(parseJsonRows('   '), []);
  });
  test('toBool handles the psql string forms that broke SIG-1', () => {
    assert.equal(toBool('f'), false);
    assert.equal(toBool('false'), false);
    assert.equal(toBool('t'), true);
    assert.equal(toBool(false), false);
    assert.equal(toBool(null), false);
  });
});

describe('SEAM-1 — credential decryption', () => {
  const SECRET = 'the-shared-secret-value';
  test('a blob decrypts with its own secret', () => {
    assert.equal(tryDecrypt(encrypt({ secretKey: 'x' }, SECRET), SECRET), true);
  });
  test('a blob does NOT decrypt with a different secret', () => {
    assert.equal(tryDecrypt(encrypt({ secretKey: 'x' }, SECRET), 'other'), false);
  });
  test('malformed blobs are false, not exceptions', () => {
    for (const b of ['', 'nodots', 'a.b', 'a.b.c.d', null, undefined]) assert.equal(tryDecrypt(b, SECRET), false);
  });
  test('all decrypting passes and names which key worked', () => {
    const r = evalSeam1({ total: 6, decrypted: 6, keySource: 'CONNECTOR_ENC_KEY (local)', allConnectors: 6 });
    assert.equal(r.status, 'pass');
    assert.match(r.evidence, /CONNECTOR_ENC_KEY/);
  });
  test('a partial decrypt fails and does not blame the vendor', () => {
    const r = evalSeam1({ total: 6, decrypted: 0, failedNames: ['a','b','c','d','e','f'], keySource: 'K' });
    assert.equal(r.status, 'fail');
    assert.match(r.fix, /Do NOT rotate/);
    assert.match(r.fix, /direct-database connectors/);
  });
  // THE REGRESSION: no key available previously produced a confident "key mismatch" fail.
  test('no key available SKIPS rather than diagnosing a mismatch', () => {
    const r = evalSeam1({ total: 5, decrypted: 0, keySource: null });
    assert.equal(r.status, 'skip');
    assert.notEqual(r.status, 'fail');
  });
  test('the denominator is disclosed when some connectors use another envelope', () => {
    const r = evalSeam1({ total: 5, decrypted: 5, keySource: 'K', allConnectors: 9 });
    assert.match(r.evidence, /of 9 connectors, 5 use this envelope/);
  });
  test('measure falls back to JWT_SECRET when CONNECTOR_ENC_KEY is absent', async () => {
    const blob = encrypt({ secretKey: 'x' }, SECRET);
    const d = await measSeam1({
      secrets: { jwtSecret: SECRET },
      query: async (sql) => sql.includes('count(*)') ? [{ n: 1 }] : [{ name: 'A', enc: blob }],
    });
    assert.equal(d.decrypted, 1);
    assert.match(d.keySource, /JWT_SECRET/);
  });
});

describe('SIG-1 — property emission (ages in seconds, from SQL)', () => {
  const props = [{ slug: 'a', active: true }, { slug: 'b', active: true }, { slug: 'z', active: false }];
  test('all active emitting recently passes', () => {
    assert.equal(evalSig1({ properties: props, emitters: { a: HOUR, b: 2 * DAY } }).status, 'pass');
  });
  test('a silent active property fails', () => {
    const r = evalSig1({ properties: props, emitters: { a: HOUR } });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /1\/2/);
  });
  test('a dormant property emitting nothing does not fail the check', () => {
    assert.equal(evalSig1({ properties: props, emitters: { a: HOUR, b: HOUR } }).status, 'pass');
  });
  // Distinct from "no emitter at all": this one HAS emitted, just too long ago. Without
  // it, the age comparison itself is untested because the missing-key guard fires first.
  test('an emitter outside the window counts as silent', () => {
    const r = evalSig1({ properties: [{ slug: 'a', active: true }], emitters: { a: 30 * DAY }, windowDays: 7 });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /1\/1 active properties silent/);
  });

  test('an emitter just inside the window is not silent', () => {
    assert.equal(evalSig1({ properties: [{ slug: 'a', active: true }], emitters: { a: 6 * DAY }, windowDays: 7 }).status, 'pass');
  });

  // THE REGRESSION: an unreadable age previously read as fresh.
  test('an unreadable age counts as SILENT, not fresh', () => {
    for (const bad of [NaN, 'never', undefined, null]) {
      const r = evalSig1({ properties: [{ slug: 'a', active: true }], emitters: { a: bad } });
      assert.equal(r.status, 'fail', `age ${String(bad)} must not read as healthy`);
    }
  });
  // THE REGRESSION: !!'f' === true made every dormant site active.
  test("measure treats the psql string 'f' as false", async () => {
    const d = await measSig1({
      query: async (sql) => sql.includes('sites')
        ? [{ slug: 'live', is_active: 't' }, { slug: 'parked', is_active: 'f' }]
        : [{ brand: 'live', age_seconds: 60 }],
    });
    assert.deepEqual(d.properties.map(p => p.active), [true, false]);
    assert.equal(evalSig1(d).status, 'pass');
  });
});

describe('SIG-2 — sync success (ages in seconds)', () => {
  const src = (name, type, status, age) => ({ name, type, status, lastSuccessAgeSeconds: age });
  test('all fresh passes', () => {
    assert.equal(evalSig2({ sources: [src('A','ga4','active',2*HOUR)], intervalHours: 6 }).status, 'pass');
  });
  test('never succeeded is stale', () => {
    const r = evalSig2({ sources: [src('A','ga4','error',null)], intervalHours: 6 });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /ga4×1/);
  });
  // THE REGRESSION: a 15h-old sync read as inside a 12h window because of TZ parsing.
  test('a 15-hour-old success is stale against a 12-hour grace', () => {
    assert.equal(evalSig2({ sources: [src('A','ga4','active',15*HOUR)], intervalHours: 6 }).status, 'fail');
  });
  test('an unreadable age is stale, not fresh', () => {
    assert.equal(evalSig2({ sources: [src('A','ga4','active',NaN)], intervalHours: 6 }).status, 'fail');
  });
  test('disabled sources are excluded regardless of case', () => {
    const r = evalSig2({ sources: [src('A','ga4','active',HOUR), src('P','appdb','DISABLED',90*DAY), src('Q','x','Inactive',90*DAY)], intervalHours: 6 });
    assert.equal(r.status, 'pass');
    assert.match(r.evidence, /1\/1/);
  });
  test('error status still counts as live and is reported', () => {
    assert.equal(evalSig2({ sources: [src('A','ga4','error',null)], intervalHours: 6 }).status, 'fail');
  });
  test('all sources disabled skips', () => {
    assert.equal(evalSig2({ sources: [src('P','x','disabled',null)] }).status, 'skip');
  });
  test('measure marks an errored row as never-succeeded', async () => {
    const d = await measSig2({ query: async () => [{ name: 'A', type: 'ga4', status: 'error', age_seconds: 60, has_error: true }] });
    assert.equal(d.sources[0].lastSuccessAgeSeconds, null);
  });
});

describe('SIG-4 — the clock must never move on a failure', () => {
  const row = (name, hasError, syncNewerThanError, status = 'active') => ({ name, hasError, syncNewerThanError, status });

  test('nothing failing means nothing could have moved a clock', () => {
    const r = evalSig4({ rows: [row('A', false, false)] });
    assert.equal(r.status, 'pass');
    assert.match(r.evidence, /no enabled source is currently in error/);
  });

  /**
   * THE FALSE POSITIVE this was rewritten for. A source that succeeded six hours ago and
   * has been failing since then has a RECENT success timestamp, and that is correct: the
   * clock is frozen at the last real success. The old form flagged all fourteen.
   */
  test('a failing source whose clock is frozen BEFORE the failure is healthy', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row('src' + i, true, false));
    const r = evalSig4({ rows });
    assert.equal(r.status, 'pass', 'a frozen clock is the correct behaviour, not a violation');
    assert.match(r.evidence, /frozen before the failure/);
  });

  // THE REGRESSION: the clock moved on a failed attempt.
  test('a success timestamp NEWER than the failure fails', () => {
    const r = evalSig4({ rows: [row('GA4 x', true, true), row('ok', false, false)] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /1\/1 failing sources/);
    assert.match(r.fix, /success branch/);
  });

  test('only the lying rows are named, not every failing one', () => {
    const r = evalSig4({ rows: [row('bad', true, true), row('fine', true, false)] });
    assert.match(r.evidence, /1\/2 failing sources/);
    assert.match(r.evidence, /bad/);
    assert.doesNotMatch(r.evidence, /fine/);
  });

  // THE SECOND FALSE POSITIVE: a parked connector carrying an explanatory note.
  test('a DISABLED source carrying a note is not a failing source', () => {
    const r = evalSig4({ rows: [row('Cove', true, true, 'disabled'), row('live', false, false)] });
    assert.equal(r.status, 'pass');
    assert.doesNotMatch(r.evidence, /Cove/);
  });

  test('a genuinely failing enabled source is still caught alongside a parked one', () => {
    const r = evalSig4({ rows: [row('Cove', true, true, 'disabled'), row('GA4', true, true, 'error')] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /GA4/);
    assert.doesNotMatch(r.evidence, /Cove/);
  });

  test('every source disabled skips rather than passing', () => {
    assert.equal(evalSig4({ rows: [row('x', true, true, 'disabled')] }).status, 'skip');
  });

  test('no rows skips', () => {
    assert.equal(evalSig4({ rows: [] }).status, 'skip');
  });
});

describe('SIG-5 — the run log sees what current state cannot', () => {
  const ok = (n, a) => ({ name: n, type: 'ga4', ok: true, ageSeconds: a, error: null });
  const bad = (n, a, e) => ({ name: n, type: 'ga4', ok: false, ageSeconds: a, error: e });
  test('all recent runs succeeding passes', () => {
    assert.equal(evalSig5({ runs: [ok('a', HOUR), ok('b', HOUR)], windowHours: 48 }).status, 'pass');
  });
  test('a HEALED outage is still reported', () => {
    const runs = [...Array.from({length:14},(_,i)=>bad('s'+i, 8*HOUR, 'Unsupported state or unable to authenticate data')),
                  ...Array.from({length:20},(_,i)=>ok('s'+i, HOUR))];
    const r = evalSig5({ runs, windowHours: 48 });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /14\/34 runs failed/);
  });
  test('one shared message is reported as ONE cause', () => {
    const runs = Array.from({length:14},(_,i)=>bad('s'+i, 8*HOUR, 'Unsupported state or unable to authenticate data'));
    const r = evalSig5({ runs, windowHours: 48 });
    assert.match(r.evidence, /1 distinct error;/);
    assert.match(r.fix, /ONE cause/);
  });
  test('failures outside the window are out of scope', () => {
    assert.equal(evalSig5({ runs: [bad('old', 200*HOUR, 'x'), ok('new', HOUR)], windowHours: 48 }).status, 'pass');
  });
  test('an empty log skips', () => {
    assert.equal(evalSig5({ runs: [], windowHours: 48 }).status, 'skip');
  });

  /**
   * THE HIDDEN WRITER. Reconstructed from the real incident of 2026-08-23: the log showed
   * 40 successful runs while fourteen connectors sat in an error state, because a SECOND
   * runner on the same schedule failed them and recorded nothing.
   */
  test('a source in error with NO failed run in the log is reported', () => {
    const runs = Array.from({ length: 20 }, (_, i) => ok('src' + i, HOUR));
    const r = evalSig5({
      runs, windowHours: 48,
      expectedSources: runs.map((x) => x.name),
      erroredSources: ['src3', 'src7', 'src11'],
    });
    assert.equal(r.status, 'fail', 'a clean log must not clear a source that is visibly failing');
    assert.match(r.evidence, /3 source\(s\) are in an error state with NO failed run/);
    assert.match(r.fix, /two cron paths on the same schedule/);
  });

  test('an error that IS explained by a logged failure is not double-reported', () => {
    const runs = [bad('src1', HOUR, 'boom'), ok('src2', HOUR)];
    const r = evalSig5({ runs, windowHours: 48, expectedSources: ['src1', 'src2'], erroredSources: ['src1'] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /1\/2 runs failed/, 'should report the logged failure, not the reconciliation');
  });

  test('a source that never appears in the log at all is reported', () => {
    const r = evalSig5({
      runs: [ok('a', HOUR)], windowHours: 48,
      expectedSources: ['a', 'b', 'c'], erroredSources: [],
    });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /2\/3 source\(s\) never appear in the log/);
  });

  test('unmeasured coverage passes but says so, rather than overclaiming', () => {
    const r = evalSig5({ runs: [ok('a', HOUR)], windowHours: 48 });
    assert.equal(r.status, 'pass');
    assert.match(r.evidence, /coverage unverified/);
  });

  test('full coverage with no failures passes and states the coverage', () => {
    const r = evalSig5({
      runs: [ok('a', HOUR), ok('b', HOUR)], windowHours: 48,
      expectedSources: ['a', 'b'], erroredSources: [],
    });
    assert.equal(r.status, 'pass');
    assert.match(r.evidence, /covering all 2 source/);
  });
  test('an unreadable age drops out of the window rather than counting as recent', () => {
    assert.equal(evalSig5({ runs: [bad('x', NaN, 'e')], windowHours: 48 }).status, 'skip');
  });
});
