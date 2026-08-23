/**
 * Mutation harness. A suite that has never failed proves nothing.
 *
 * Each mutation reintroduces a defect that ACTUALLY HAPPENED — in the portfolio, or in
 * this engine during its own adversarial review. If the suite still passes with the defect
 * in place, that test is decorative and the harness exits non-zero.
 *
 * Two rules learned the hard way:
 *   - A mutation whose anchor no longer matches has tested NOTHING. It fails the run
 *     rather than being tallied as caught.
 *   - The harness runs the WHOLE suite. Pointing it at one file let five mutations survive
 *     because a second test file existed and was never consulted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const S = (p) => resolve(root, 'src/seam', p);

const MUTATIONS = [
  { name: 'SEAM-1: decryption always "succeeds" (never actually verifies)',
    file: S('invariants/seam1-decrypt.mjs'),
    from: '  } catch {\n    return false;\n  }',
    to:   '  } catch {\n    return true;\n  }' },

  { name: 'SEAM-1: a partial decrypt counts as a pass',
    file: S('invariants/seam1-decrypt.mjs'),
    from: '  if (decrypted === total) {',
    to:   '  if (decrypted >= 0) {' },

  { name: 'SEAM-1: no key available diagnoses a mismatch instead of skipping',
    file: S('invariants/seam1-decrypt.mjs'),
    from: '  if (!data?.keySource) {',
    to:   '  if (false) {' },

  { name: 'SIG-1: a property with no emitter is treated as fine',
    file: S('invariants/sig1-emission.mjs'),
    from: '    return Number(age) > maxAge;',
    to:   '    return false;' },

  { name: 'SIG-1: an unreadable age reads as fresh (NaN comparison always false)',
    file: S('invariants/sig1-emission.mjs'),
    from: '    if (age === null || age === undefined || !Number.isFinite(Number(age))) return true;',
    to:   '    if (age === null || age === undefined || !Number.isFinite(Number(age))) return false;' },

  { name: "SIG-1: psql's 'f' coerced with !! (every dormant site reads active)",
    file: S('invariants/sig1-emission.mjs'),
    from: 'active: TO_BOOL(s.is_active)',
    to:   'active: !!s.is_active' },

  { name: 'SIG-2: never-succeeded counts as success (the original 25-day bug)',
    file: S('invariants/sig2-sync.mjs'),
    from: '    if (age === null || age === undefined || !Number.isFinite(Number(age))) return true;',
    to:   '    if (age === null || age === undefined || !Number.isFinite(Number(age))) return false;' },

  { name: 'SIG-2: the disabled list becomes case-sensitive again',
    file: S('invariants/sig2-sync.mjs'),
    from: "  const live = sources.filter(s => !OFF.includes(String(s.status ?? '').toLowerCase()));",
    to:   '  const live = sources.filter(s => !OFF.includes(s.status));' },

  { name: 'SIG-4: a deliberately disabled source is judged as failing',
    file: S('invariants/sig4-freshness.mjs'),
    from: "  const live = rows.filter((r) => !OFF.includes(String(r.status ?? '').toLowerCase()));",
    to:   '  const live = rows.slice();' },

  { name: 'SIG-4: a clock that moved on a failure is forgiven',
    file: S('invariants/sig4-freshness.mjs'),
    from: '  const lying = errored.filter((r) => r.syncNewerThanError === true);',
    to:   '  const lying = [];' },

  { name: 'SIG-4: a correctly frozen clock is flagged as lying (the false positive)',
    file: S('invariants/sig4-freshness.mjs'),
    from: '  const lying = errored.filter((r) => r.syncNewerThanError === true);',
    to:   '  const lying = errored.slice();' },

  { name: 'SIG-5: a healed outage is forgiven (the mistake this check exists for)',
    file: S('invariants/sig5-runlog.mjs'),
    from: '  const failures = recent.filter((r) => !r.ok);',
    to:   '  const failures = [];' },

  { name: 'SIG-5: an error with no logged failure is ignored (the hidden second writer)',
    file: S('invariants/sig5-runlog.mjs'),
    from: '  if (unexplained.length) {',
    to:   '  if (false) {' },

  { name: 'SIG-5: a source absent from the log is treated as covered',
    file: S('invariants/sig5-runlog.mjs'),
    from: '    if (missing.length) {',
    to:   '    if (false) {' },

  { name: 'SIG-5: an empty run log reads as a clean history',
    file: S('invariants/sig5-runlog.mjs'),
    from: '  const emptyRecent = requireSample(recent.length,',
    to:   '  const emptyRecent = requireSample(recent.length + 1,' },

  { name: 'ROLL-UP: a run full of skips reports PASS and exits 0',
    file: S('run.mjs'),
    from: "  if (results.some((r) => r.status === 'skip')) return 'incomplete';",
    to:   "  if (false) return 'incomplete';" },

  { name: 'ROLL-UP: incomplete exits 0, so the gate goes green on nothing',
    file: S('run.mjs'),
    from: "  return verdict === 'pass' ? 0 : verdict === 'fail' ? 1 : 2;",
    to:   "  return verdict === 'fail' ? 1 : 0;" },

  { name: 'PLUMBING: rows split on newlines again (a stack trace fabricates rows)',
    file: S('run.mjs'),
    from: '  const rows = JSON.parse(text);',
    to:   '  const rows = text.split("\\n").map((l) => ({ raw: l }));' },

  { name: 'PLUMBING: toBool treats every string as true',
    file: S('run.mjs'),
    from: "  return s === 't' || s === 'true' || s === '1';",
    to:   '  return !!v;' },

  { name: 'LINKS: only project.json is read, repo.json ignored (misses live links)',
    file: S('links.mjs'),
    from: '  for (const p of j.projects ?? []) {',
    to:   '  for (const p of []) {' },

  { name: 'DEP-1: a truncated project listing accuses live projects (found in the wild)',
    file: S('invariants/dep1-links.mjs'),
    from: '  if (data.listingComplete === false) {',
    to:   '  if (false) {' },

  { name: 'DEP-1: an empty project list condemns every link instead of skipping',
    file: S('invariants/dep1-links.mjs'),
    from: '  const emptyProjects = requireSample(existing.size,',
    to:   '  const emptyProjects = requireSample(existing.size + 1,' },

  { name: 'DEP-2: two link files in ONE directory counted as a duplicate',
    file: S('invariants/dep2-duplicate.mjs'),
    from: '.filter(([, ls]) => new Set(ls.map((l) => l.dir)).size > 1)',
    to:   '.filter(([, ls]) => ls.length > 1)' },

  { name: 'SUR-1: a 200 is success regardless of which product answered',
    file: S('invariants/sur1-domains.mjs'),
    from: '    if (d.finalHost && !sameBrand(d.domain, d.finalHost))',
    to:   '    if (false && d.finalHost && !sameBrand(d.domain, d.finalHost))' },

  { name: 'SEC-1: placeholder credentials reported as real leaks (alert fatigue)',
    file: S('invariants/sec1-secrets.mjs'),
    from: "  if (/^(localhost|127\\.0\\.0\\.1|host|db|postgres)(:\\d+)?$/i.test(host)) return false;",
    to:   '  if (false) return false;' },

  { name: 'GUARD: a directory with no manifest is allowed to deploy',
    file: S('guard.mjs'),
    from: '  if (!data.hasManifest) {',
    to:   '  if (false) {' },

  { name: 'GUARD: a shared production link stops being a refusal',
    file: S('guard.mjs'),
    from: '  if (data.otherClaimants?.length) {',
    to:   '  if (false) {' },

  { name: 'GUARD: an unchecked project list is read as deleted',
    file: S('guard.mjs'),
    from: '  if (data.link && data.projectExists === false) {',
    to:   '  if (data.link && !data.projectExists) {' },

  { name: 'SEAM-2: a dropped tenant column stops being a failure',
    file: S('invariants/seam2-schema.mjs'),
    from: '    const drifted = (p.fieldDrift ?? []).filter((d) => d.missing.length);',
    to:   '    const drifted = [];' },

  { name: 'SEAM-3: distinct builds of one package count as identical',
    file: S('invariants/seam3-sdk.mjs'),
    from: '  const forked = data.packages.filter((p) => new Set(p.copies.map((c) => c.sha)).size > 1);',
    to:   '  const forked = [];' },

  { name: 'SEAM-4: a 404 default host counts as answering',
    file: S('invariants/seam4-hosts.mjs'),
    from: '  const dead = data.hosts.filter((h) => !h.status || h.status >= 400);',
    to:   '  const dead = [];' },

  { name: 'SIG-3: a write-only store counts as read',
    file: S('invariants/sig3-unread.mjs'),
    from: '  const writeOnly = data.stores.filter((s) => s.writes > 0 && s.reads === 0);',
    to:   '  const writeOnly = [];' },

  { name: 'SEC-2: a shared secret falling back to a local one is ignored',
    file: S('invariants/sec2-fallback.mjs'),
    from: '  const sites = data.sites ?? [];',
    to:   '  const sites = [];' },

  { name: 'HEARTBEAT: never having run reads as healthy instead of critical',
    file: S('heartbeat.mjs'),
    from: "    return { state: 'missing', evidence: 'the seam doctor has never recorded a run' };",
    to:   "    return { state: 'live', evidence: 'no beats' };" },

  { name: 'HEARTBEAT: a stale run keeps showing its last green verdict',
    file: S('heartbeat.mjs'),
    from: '  if (ageMinutes > limit) {',
    to:   '  if (false) {' },

  { name: 'HEARTBEAT: staleness stops outranking the verdict on the board',
    file: S('heartbeat.mjs'),
    from: "  if (freshness.state === 'stale') return { severity: 'critical', text: `SEAM DOCTOR IS STALE (${freshness.ageMinutes}m)` };",
    to:   "  if (freshness.state === 'stale') return { severity: 'ok', text: 'stale but fine' };" },

  { name: 'HEARTBEAT: an incomplete run reads as healthy',
    file: S('heartbeat.mjs'),
    from: "  if (v === 'incomplete') return { severity: 'warning', text: `seam doctor incomplete: ${freshness.last.skip} check(s) could not be measured` };",
    to:   '' },

  { name: 'CONTRACT: an empty sample passes instead of skipping',
    file: S('contract.mjs'),
    from: '  if (n === 0) {',
    to:   '  if (false) {' },

  { name: 'CONTRACT: evidence becomes optional',
    file: S('contract.mjs'),
    from: "  if (!evidence) throw new Error(`result ${id}: evidence is required — a verdict without it is a claim`);",
    to:   '  evidence = evidence || "";' },
];

function suiteFails() {
  try {
    execFileSync('sh', ['-c', 'node --test test/*.test.mjs'], { cwd: root, stdio: 'pipe' });
    return false;
  } catch { return true; }
}

/** A mutation that breaks parsing proves nothing about the tests. */
function parses(file) {
  try { execFileSync('node', ['--check', file], { cwd: root, stdio: 'pipe' }); return true; }
  catch { return false; }
}

let survived = 0, skipped = 0, unparseable = 0;
console.log('Reintroducing defects that actually happened, one at a time.\n');
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, 'utf8');
  if (!original.includes(m.from)) {
    console.log(`  SKIPPED   ${m.name}  <- anchor not found; this mutation tested NOTHING`);
    skipped++;
    continue;
  }
  writeFileSync(m.file, original.replace(m.from, m.to));
  const ok = parses(m.file);
  const caught = ok ? suiteFails() : false;
  writeFileSync(m.file, original);
  if (!ok) { console.log(`  BROKEN    ${m.name}  <- mutation is a syntax error, proves nothing`); unparseable++; continue; }
  console.log(`  ${caught ? 'CAUGHT  ' : 'SURVIVED'}  ${m.name}`);
  if (!caught) survived++;
}

const caught = MUTATIONS.length - survived - skipped - unparseable;
console.log(`\n${caught}/${MUTATIONS.length} defects caught, ${survived} survived, ${skipped} not applied, ${unparseable} malformed.`);
if (survived) console.log('A surviving mutation means that test cannot fail. Fix the test, not the mutation.');
if (skipped) console.log('An unapplied mutation proves nothing. Repair its anchor.');
if (unparseable) console.log('A mutation that breaks parsing tests the loader, not the logic. Rewrite it.');
if (survived || skipped || unparseable) process.exit(1);
