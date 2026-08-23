/**
 * Seam Doctor runner.
 *
 * Measure (IO) then evaluate (pure), per invariant. The two never mix, so every verdict
 * in the report was produced by a function a test can call with crafted data.
 *
 * TWO CORRECTIONS FROM ADVERSARIAL REVIEW, 2026-08-23:
 *
 * 1. Queries now return ONE LINE OF JSON. The previous version split psql output on
 *    newlines and derived column names from the SQL text with a regex. A stack trace in a
 *    text column fabricated extra rows and corrupted both sides of every ratio; a subquery
 *    or a `substring(x from y)` in a select list silently produced a wrong column map. JSON
 *    removes the entire class: no separator to collide with, no newline to split on, no
 *    column names to guess, and real types instead of strings.
 *
 * 2. A run containing SKIPs is INCOMPLETE, never a pass. The per-check guard correctly
 *    refuses to assert on an empty sample, and the roll-up then reported five skips as a
 *    green PASS with exit 0 — the exact defect the guard exists to prevent, one layer up.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import seam1 from './invariants/seam1-decrypt.mjs';
import sig1 from './invariants/sig1-emission.mjs';
import sig2 from './invariants/sig2-sync.mjs';
import sig4 from './invariants/sig4-freshness.mjs';
import sig5 from './invariants/sig5-runlog.mjs';
import dep1 from './invariants/dep1-links.mjs';
import dep2 from './invariants/dep2-duplicate.mjs';
import dep3 from './invariants/dep3-buildable.mjs';
import sur1 from './invariants/sur1-domains.mjs';
import sur2 from './invariants/sur2-remote.mjs';
import sec1 from './invariants/sec1-secrets.mjs';
import seam2 from './invariants/seam2-schema.mjs';
import seam3 from './invariants/seam3-sdk.mjs';
import seam4 from './invariants/seam4-hosts.mjs';
import sig3 from './invariants/sig3-unread.mjs';
import sec2 from './invariants/sec2-fallback.mjs';

export const INVARIANTS = [seam1, seam2, seam3, seam4, sig1, sig2, sig3, sig4, sig5, dep1, dep2, dep3, sur1, sur2, sec1, sec2];

/** Read one KEY=value from a dotenv-style file. Returns the value, never logs it. */
export function readEnvValue(path, name) {
  try {
    const m = new RegExp('^' + name + '="?([^"\\n]*)"?$', 'm').exec(readFileSync(path, 'utf8'));
    return m && m[1] ? m[1] : null;
  } catch { return null; }
}

/** Wrap a query so Postgres returns a single JSON array. */
export function asJsonQuery(sql) {
  return 'select coalesce(json_agg(t), \'[]\'::json)::text from (' + sql + ') t';
}

/** Parse the single-line JSON result. Pure, so it is unit-testable. */
export function parseJsonRows(stdout) {
  const text = String(stdout).trim();
  if (!text) return [];
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('query did not return a JSON array');
  return rows;
}

export function makeQuery(connectionString) {
  return async (sql) => {
    const out = execFileSync('psql', [connectionString, '-At', '-c', asJsonQuery(sql)], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    });
    return parseJsonRows(out);
  };
}

/** Postgres booleans arrive as real booleans through JSON, but stay defensive. */
export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return false;
  const s = String(v).toLowerCase();
  return s === 't' || s === 'true' || s === '1';
}

/** Roll up. Any fail -> fail. Otherwise any skip -> incomplete. Only all-pass is a pass. */
export function verdictOf(results) {
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status === 'skip')) return 'incomplete';
  if (results.length === 0) return 'incomplete';
  return 'pass';
}

/** Exit code: 0 pass, 1 fail, 2 incomplete. Incomplete is not success. */
export function exitCodeOf(verdict) {
  return verdict === 'pass' ? 0 : verdict === 'fail' ? 1 : 2;
}

export async function runSeamDoctor(ctx, { only } = {}) {
  const results = [];
  for (const inv of INVARIANTS) {
    if (only && !only.includes(inv.id)) continue;
    if (ctx.runner && inv.runner !== ctx.runner) continue;
    try {
      results.push(inv.evaluate(await inv.measure(ctx)));
    } catch (err) {
      results.push({
        id: inv.id, title: inv.title, scope: inv.scope, status: 'fail',
        evidence: 'check could not run: ' + String(err.message).slice(0, 160),
        fix: 'Repair the measurement path. An invariant that silently stops running is the failure this engine exists to prevent.',
      });
    }
  }
  return {
    ranAt: (ctx.now ?? new Date()).toISOString(),
    verdict: verdictOf(results),
    counts: {
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      skip: results.filter((r) => r.status === 'skip').length,
    },
    results,
  };
}

export function printReport(report) {
  const g = (s) => '\x1b[32m' + s + '\x1b[0m';
  const r = (s) => '\x1b[31m' + s + '\x1b[0m';
  const y = (s) => '\x1b[33m' + s + '\x1b[0m';
  const dim = (s) => '\x1b[2m' + s + '\x1b[0m';
  console.log('\nSeam Doctor . ' + report.ranAt + '\n');
  for (const res of report.results) {
    const mark = res.status === 'pass' ? g('pass') : res.status === 'fail' ? r('FAIL') : y('skip');
    console.log('  ' + mark + '  ' + res.id.padEnd(8) + ' ' + res.title);
    console.log('        ' + dim(res.scope));
    console.log('        ' + res.evidence);
    if (res.fix) console.log('        ' + y('fix:') + ' ' + res.fix);
    console.log('');
  }
  const c = report.counts;
  const v = report.verdict === 'pass' ? g('PASS') : report.verdict === 'fail' ? r('FAIL') : y('INCOMPLETE');
  console.log('  ' + c.pass + ' pass . ' + c.fail + ' fail . ' + c.skip + ' skip -> ' + v);
  if (report.verdict === 'incomplete') {
    console.log('  ' + y('A skip is not a pass. Something could not be measured; the run proves nothing about it.'));
  }
  console.log('');
}
