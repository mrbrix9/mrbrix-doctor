import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beatFrom, writeBeat, readBeats, assessFreshness, boardLine } from '../src/seam/heartbeat.mjs';

const NOW = new Date('2026-08-23T12:00:00Z');
const minsAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString();
const beat = (at, over = {}) => ({ at, verdict: 'pass', pass: 5, fail: 0, skip: 0, failing: [], ...over });

describe('heartbeat — the record that it ran at all', () => {
  test('a beat carries the verdict and which checks failed', () => {
    const b = beatFrom({
      ranAt: NOW.toISOString(), verdict: 'fail',
      counts: { pass: 3, fail: 2, skip: 1 },
      results: [{ id: 'SIG-1', status: 'fail' }, { id: 'DEP-2', status: 'fail' }, { id: 'X', status: 'pass' }],
    });
    assert.deepEqual(b.failing, ['SIG-1', 'DEP-2']);
    assert.equal(b.verdict, 'fail');
  });

  test('beats append and are capped, newest last', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam-'));
    const file = join(dir, 'nested', 'hb.json');
    try {
      for (let i = 0; i < 5; i++) writeBeat(file, beat(minsAgo(50 - i)), { keep: 3 });
      const kept = readBeats(file);
      assert.equal(kept.length, 3);
      assert.equal(kept[kept.length - 1].at, minsAgo(46));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an unreadable or absent file reads as no beats, not a crash', () => {
    assert.deepEqual(readBeats('/nonexistent/path/hb.json'), []);
  });
});

describe('staleness — judged by a reader, never by the thing being judged', () => {
  // THE WHOLE POINT: absence is the most dangerous state, not the safest.
  test('never having run is CRITICAL, not healthy', () => {
    const f = assessFreshness([], { now: NOW });
    assert.equal(f.state, 'missing');
    assert.equal(boardLine(f).severity, 'critical');
  });

  test('a recent run is live', () => {
    const f = assessFreshness([beat(minsAgo(30))], { now: NOW, intervalMinutes: 360 });
    assert.equal(f.state, 'live');
  });

  // A stopped clock keeps showing its last, probably-green, result.
  test('a run older than two intervals is STALE and outranks its own green verdict', () => {
    const f = assessFreshness([beat(minsAgo(1000), { verdict: 'pass' })], { now: NOW, intervalMinutes: 360 });
    assert.equal(f.state, 'stale');
    const line = boardLine(f);
    assert.equal(line.severity, 'critical');
    assert.match(line.text, /STALE/);
    assert.doesNotMatch(line.text, /healthy/);
  });

  test('exactly at the limit is still live; past it is stale', () => {
    assert.equal(assessFreshness([beat(minsAgo(720))], { now: NOW, intervalMinutes: 360 }).state, 'live');
    assert.equal(assessFreshness([beat(minsAgo(721))], { now: NOW, intervalMinutes: 360 }).state, 'stale');
  });

  test('an unreadable timestamp is missing, not fresh', () => {
    assert.equal(assessFreshness([beat('not-a-date')], { now: NOW }).state, 'missing');
  });

  test('the newest beat is the one judged, not the first', () => {
    const f = assessFreshness([beat(minsAgo(5000)), beat(minsAgo(10))], { now: NOW, intervalMinutes: 360 });
    assert.equal(f.state, 'live');
  });
});

describe('board line — what a human sees first', () => {
  test('staleness outranks a failing verdict', () => {
    const f = assessFreshness([beat(minsAgo(9999), { verdict: 'fail', fail: 3, failing: ['A'] })], { now: NOW, intervalMinutes: 360 });
    assert.match(boardLine(f).text, /STALE/);
  });
  test('a fresh failing run names the failing checks', () => {
    const f = assessFreshness([beat(minsAgo(5), { verdict: 'fail', fail: 2, failing: ['SIG-1', 'DEP-2'] })], { now: NOW });
    const l = boardLine(f);
    assert.equal(l.severity, 'critical');
    assert.match(l.text, /SIG-1, DEP-2/);
  });
  test('an incomplete run is a warning, and never reads as healthy', () => {
    const f = assessFreshness([beat(minsAgo(5), { verdict: 'incomplete', skip: 4 })], { now: NOW });
    const l = boardLine(f);
    assert.equal(l.severity, 'warning');
    assert.doesNotMatch(l.text, /healthy/);
  });
  test('only an all-pass fresh run reads healthy', () => {
    assert.equal(boardLine(assessFreshness([beat(minsAgo(5))], { now: NOW })).severity, 'ok');
  });
});
