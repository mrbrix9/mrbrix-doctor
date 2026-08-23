import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseLinkFile } from '../src/seam/links.mjs';
import { evaluate as evalDep1 } from '../src/seam/invariants/dep1-links.mjs';
import { evaluate as evalDep2 } from '../src/seam/invariants/dep2-duplicate.mjs';
import { evaluate as evalDep3 } from '../src/seam/invariants/dep3-buildable.mjs';
import { evaluate as evalSur1, sameBrand } from '../src/seam/invariants/sur1-domains.mjs';
import { evaluate as evalSur2 } from '../src/seam/invariants/sur2-remote.mjs';
import { evaluate as evalSec1, isRealCredential } from '../src/seam/invariants/sec1-secrets.mjs';

describe('link parsing — two formats, and a sweep for one misses the other', () => {
  test('project.json yields one link', () => {
    const r = parseLinkFile('/x/app/.vercel/project.json', JSON.stringify({ projectId: 'prj_A', projectName: 'app' }));
    assert.equal(r.length, 1);
    assert.equal(r[0].projectId, 'prj_A');
    assert.equal(r[0].dir, '/x/app');
  });

  // THE REGRESSION: repo.json has no projectId key at all.
  test('repo.json yields links even though it has no projectId key', () => {
    const r = parseLinkFile('/x/mono/.vercel/repo.json', JSON.stringify({
      remoteName: 'origin',
      projects: [{ id: 'prj_B', name: 'trackpass', directory: 'apps/trackpass' }],
    }));
    assert.equal(r.length, 1);
    assert.equal(r[0].projectId, 'prj_B');
    assert.equal(r[0].projectName, 'trackpass');
  });

  test('a repo.json naming several projects yields several links', () => {
    const r = parseLinkFile('/x/mono/.vercel/repo.json', JSON.stringify({
      projects: [{ id: 'prj_B', name: 'b' }, { id: 'prj_C', name: 'c' }],
    }));
    assert.equal(r.length, 2);
  });

  test('malformed json yields nothing rather than throwing', () => {
    assert.deepEqual(parseLinkFile('/x/.vercel/project.json', 'not json'), []);
  });
});

describe('DEP-1 — dangling links', () => {
  const links = [
    { dir: '/d/a', projectId: 'p1', projectName: 'a' },
    { dir: '/d/b', projectId: 'p2', projectName: 'b' },
  ];
  test('all resolving is a pass', () => {
    assert.equal(evalDep1({ links, existingIds: ['p1', 'p2'] }).status, 'pass');
  });
  test('a link to a deleted project fails and names it', () => {
    const r = evalDep1({ links, existingIds: ['p1'] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /1\/2/);
    assert.match(r.fix, /Move any real vercel.json config OUT/);
  });
  // THE DANGEROUS FALSE POSITIVE: if the project list fails to load, do not condemn everything.
  test('an empty project list SKIPS rather than declaring every link dead', () => {
    const r = evalDep1({ links, existingIds: [] });
    assert.equal(r.status, 'skip');
    assert.notEqual(r.status, 'fail');
  });
  // THE REGRESSION, found by running against reality: the project list paginates at 20.
  // Reading one page made eight LIVE projects look deleted.
  test('a truncated project listing SKIPS rather than accusing live projects', () => {
    const r = evalDep1({ links, existingIds: ['p1'], listingComplete: false });
    assert.equal(r.status, 'skip');
    assert.notEqual(r.status, 'fail');
    assert.match(r.evidence, /truncated/);
  });

  test('a complete listing still accuses correctly', () => {
    const r = evalDep1({ links, existingIds: ['p1'], listingComplete: true });
    assert.equal(r.status, 'fail');
  });

  test('no links at all skips', () => {
    assert.equal(evalDep1({ links: [], existingIds: ['p1'] }).status, 'skip');
  });
});

describe('DEP-2 — duplicate claims', () => {
  test('one directory per project passes', () => {
    assert.equal(evalDep2({ links: [{ dir: '/a', projectId: 'p1' }, { dir: '/b', projectId: 'p2' }] }).status, 'pass');
  });
  test('two directories claiming one project fails', () => {
    const r = evalDep2({ links: [
      { dir: '/real', projectId: 'p1', projectName: 'textayo' },
      { dir: '/shell', projectId: 'p1', projectName: 'textayo' },
    ] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /textayo×2/);
  });
  // Two link FILES in one directory (project.json + repo.json) is not two directories.
  test('two link files in the SAME directory is not a duplicate claim', () => {
    const r = evalDep2({ links: [
      { dir: '/mono', projectId: 'p1', projectName: 'x', format: 'project.json' },
      { dir: '/mono', projectId: 'p1', projectName: 'x', format: 'repo.json' },
    ] });
    assert.equal(r.status, 'pass');
  });
});

describe('DEP-3 — buildable', () => {
  test('all buildable passes', () => {
    assert.equal(evalDep3({ links: [{ dir: '/a', buildable: true }] }).status, 'pass');
  });
  test('a linked directory with no manifest fails', () => {
    const r = evalDep3({ links: [{ dir: '/x/shell', projectName: 'textayo', buildable: false }, { dir: '/y', buildable: true }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /1\/2/);
  });
});

describe('SUR-1 — domains serve their own product', () => {
  test('apex and www of the same name are the same brand', () => {
    assert.equal(sameBrand('textayo.com', 'www.textayo.com'), true);
    assert.equal(sameBrand('grand.tennis', 'grand.tennis'), true);
  });
  test('a different registrable name is NOT the same brand', () => {
    assert.equal(sameBrand('report.claims', 'www.mrbrix.com'), false);
  });
  test('healthy domains pass', () => {
    assert.equal(evalSur1({ domains: [{ domain: 'textayo.com', finalHost: 'www.textayo.com', status: 200, resolved: true }] }).status, 'pass');
  });
  // THE REGRESSION: a 200 is not success if it is somebody else's page.
  test('a domain redirecting to another product fails despite a 200', () => {
    const r = evalSur1({ domains: [{ domain: 'report.claims', finalHost: 'www.mrbrix.com', status: 200, resolved: true }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /report.claims -> www.mrbrix.com/);
  });
  test('a domain with no DNS fails', () => {
    const r = evalSur1({ domains: [{ domain: 'insure.claims', finalHost: null, status: 0, resolved: false }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /does not resolve/);
  });
  test('no domains configured skips', () => {
    assert.equal(evalSur1({ domains: [] }).status, 'skip');
  });
});

describe('SUR-2 — every deployed directory has a remote', () => {
  test('all with remotes passes', () => {
    assert.equal(evalSur2({ links: [{ dir: '/a', remote: 'git@github.com:x/a.git' }] }).status, 'pass');
  });
  test('a deployed directory with no remote fails', () => {
    const r = evalSur2({ links: [{ dir: '/x/ssc-guide', remote: null }, { dir: '/y', remote: 'git@g:y.git' }] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /ssc-guide/);
  });
});

describe('SEC-1 — credentials in tracked files', () => {
  test('a real credential is detected', () => {
    assert.equal(isRealCredential('postgresql://neondb_owner:npg_realLooking123@ep-shy-boat-am6j1cok.aws.neon.tech/neondb'), true);
  });
  // These must NOT be reported, or the check becomes noise nobody reads.
  // Isolates the localhost rule specifically: a REAL-looking user and password pointed at
  // localhost is still not a leak. Without this, removing the localhost guard is masked by
  // the placeholder-user guard and no test notices.
  test('a real-looking credential on localhost is still not a leak', () => {
    assert.equal(isRealCredential('postgresql://neondb_owner:npg_S3cretLooking99@localhost:5432/db'), false);
    assert.equal(isRealCredential('postgres://neondb_owner:npg_S3cretLooking99@127.0.0.1:5432/db'), false);
  });

  test('placeholders and localhost are not leaks', () => {
    assert.equal(isRealCredential('postgres://user:password@localhost:5432/db'), false);
    assert.equal(isRealCredential('postgresql://user:pass@ep-xxx-pooler.aws.neon.tech/db'), false);
    assert.equal(isRealCredential('postgres://username:yourpassword@host/db'), false);
    assert.equal(isRealCredential('not-a-url'), false);
  });
  test('a clean scan passes', () => {
    assert.equal(evalSec1({ findings: [], filesScanned: 4000 }).status, 'pass');
  });
  test('findings fail and the fix says ROTATE before delete', () => {
    const r = evalSec1({ filesScanned: 4000, findings: [
      { repo: 'nikkimike', file: '.claude/settings.local.json', count: 18, hosts: ['ep-a', 'ep-b', 'ep-c'] },
      { repo: 'nikkimike', file: 'scripts/x.ts', count: 3, hosts: ['ep-a'] },
    ] });
    assert.equal(r.status, 'fail');
    assert.match(r.evidence, /21 credentialed strings in 2 tracked file/);
    assert.match(r.evidence, /3 distinct database host/);
    assert.match(r.fix, /ROTATE/);
  });
  test('scanning zero files skips rather than reporting all clear', () => {
    assert.equal(evalSec1({ findings: [], filesScanned: 0 }).status, 'skip');
  });
});
