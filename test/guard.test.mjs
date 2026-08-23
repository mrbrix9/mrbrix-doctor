import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assess, formatRefusal } from '../src/seam/guard.mjs';
import { isRealCredential } from '../src/seam/invariants/sec1-secrets.mjs';

const link = (name, id = 'prj_1') => ({ dir: '/d', projectId: id, projectName: name });

describe('pre-deploy guard — refuses at the moment of risk', () => {
  test('a healthy directory is allowed', () => {
    const v = assess({ dir: '/d', hasManifest: true, link: link('app'), otherClaimants: [], projectExists: true });
    assert.equal(v.ok, true);
    assert.equal(v.problems.length, 0);
  });

  // The shell folder holding a live customer site's link.
  test('no manifest refuses, and names the project it would have hit', () => {
    const v = assess({ dir: '/shell', hasManifest: false, link: link('textayo'), otherClaimants: [], projectExists: true });
    assert.equal(v.ok, false);
    assert.equal(v.problems[0].code, 'NO_MANIFEST');
    assert.match(v.problems[0].why, /textayo/);
  });

  test('an unlinked directory refuses, because a deploy would CREATE a project', () => {
    const v = assess({ dir: '/d', hasManifest: true, link: null, otherClaimants: [] });
    assert.equal(v.ok, false);
    assert.equal(v.problems[0].code, 'NO_LINK');
    assert.match(v.problems[0].why, /create a NEW project/);
  });

  test('a deleted project refuses', () => {
    const v = assess({ dir: '/d', hasManifest: true, link: link('zovu'), otherClaimants: [], projectExists: false });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === 'DEAD_PROJECT'));
  });

  // null means "not checked" and must never be read as "absent".
  test('an unchecked project list does NOT accuse the project of being deleted', () => {
    const v = assess({ dir: '/d', hasManifest: true, link: link('app'), otherClaimants: [], projectExists: null });
    assert.equal(v.ok, true);
  });

  test('a project claimed by two directories refuses from BOTH', () => {
    const v = assess({ dir: '/real', hasManifest: true, link: link('textayo'), otherClaimants: ['/shell'], projectExists: true });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === 'SHARED_LINK'));
    assert.match(v.problems[0].why, /whichever folder runs the command wins/);
  });

  test('the single-claimant wording is not pluralised', () => {
    const v = assess({ dir: '/a', hasManifest: true, link: link('x'), otherClaimants: ['/b'], projectExists: true });
    assert.match(v.problems[0].say, /^another directory/);
  });

  test('several problems are all reported, not just the first', () => {
    const v = assess({ dir: '/d', hasManifest: false, link: link('x'), otherClaimants: ['/e'], projectExists: false });
    assert.equal(v.problems.length, 3);
  });

  test('the refusal text names the directory and offers the override', () => {
    const v = assess({ dir: '/shell', hasManifest: false, link: link('textayo'), otherClaimants: [], projectExists: true });
    const text = formatRefusal(v);
    assert.match(text, /REFUSING TO DEPLOY from \/shell/);
    assert.match(text, /--force/);
  });
});

describe('credential detection — POSIX patterns are not JavaScript patterns', () => {
  /**
   * THE REGRESSION. `[[:space:]]` is a POSIX class that git grep understands and
   * JavaScript does not. Reusing the grep string inside new RegExp() made the guard
   * report a repository with 22 committed credentials as CLEAN.
   */
  const JS_PATTERN = /postgres(?:ql)?:\/\/[^:/@\s]+:[^@\s]+@[^/\s"]+/g;
  const POSIX_PATTERN = 'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@[^/[:space:]"]+';

  const LINE = 'DATABASE_URL="postgresql://neondb_owner:npg_Secret123@ep-shy-boat-am6j1cok.aws.neon.tech/neondb"';

  test('the JS pattern extracts a real credential from a line', () => {
    const found = [...LINE.matchAll(JS_PATTERN)].map((m) => m[0]);
    assert.equal(found.length, 1);
    assert.equal(isRealCredential(found[0]), true);
  });

  test('the POSIX pattern used as a JS RegExp finds NOTHING — this is the trap', () => {
    const found = [...LINE.matchAll(new RegExp(POSIX_PATTERN, 'g'))].map((m) => m[0]);
    assert.equal(found.length, 0, 'if this ever matches, the two patterns have converged and the guard can share one');
  });

  test('a username containing s, p, a, c or e still matches', () => {
    for (const user of ['neondb_owner', 'space_user', 'postgres', 'apace']) {
      const line = `postgresql://${user}:npg_Real123@ep-host.neon.tech/db`;
      const found = [...line.matchAll(JS_PATTERN)].map((m) => m[0]);
      assert.equal(found.length, 1, `failed for user ${user}`);
    }
  });

  test('placeholders are extracted but not counted as leaks', () => {
    const line = 'postgres://user:password@localhost:5432/db';
    const found = [...line.matchAll(JS_PATTERN)].map((m) => m[0]);
    assert.equal(found.length, 1);
    assert.equal(isRealCredential(found[0]), false);
  });
});
