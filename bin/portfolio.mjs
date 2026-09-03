#!/usr/bin/env node
/**
 * PORTFOLIO SWEEP — run Doctor across every property that has a config.
 *
 * Discipline #22 gives each property a way to sense itself. It did not give the
 * portfolio a way to sense whether the properties are being sensed at all, and
 * that gap hid a real one: on 2026-09-01, eight repos carried a
 * `doctor.config.json` and only two ever ran it. Six configs sat there looking
 * like coverage and asserting nothing. A check nobody runs is indistinguishable
 * from a check that passes, which is the failure this whole tool exists to stop.
 *
 *   doctor-portfolio                     every property under ~/Desktop
 *   doctor-portfolio --root ~/work       elsewhere
 *   doctor-portfolio --only 4grand,mxta  a subset
 *   doctor-portfolio --repo-only         no network, gate-speed
 *   doctor-portfolio --json out.json     machine-readable roll-up
 *
 * Each property is run through the SAME CLI a project runs itself, in its own
 * process, so a sweep verdict and a local verdict cannot disagree. Spawning
 * rather than importing also means one property that throws cannot take the
 * sweep down with it.
 *
 * EXIT CODES, and the reason there are three:
 *   0  every property passed
 *   1  at least one property failed an assertion
 *   2  INCOMPLETE — a property could not be run, or none were found
 *
 * 2 exists because "nothing ran" and "everything is fine" produce the same
 * silence, and only one of them is good news. A sweep that discovers no
 * properties is a broken sweep, not a clean portfolio, so it never exits 0.
 */

import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { discoverIn } from '../src/discover.mjs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCTOR = join(HERE, 'doctor.mjs');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};
const has = name => argv.includes(`--${name}`);

if (has('help')) {
  console.log(`
  doctor-portfolio — run Doctor across every property that has a doctor.config.json

    --root <dir>       where to look for properties (default ~/Desktop)
    --only a,b         only these directory names
    --repo-only        skip live-surface assertions (no network)
    --json <path>      write the roll-up here
    --concurrency <n>  properties in flight (default 3)

  Exit: 0 all passed · 1 something failed · 2 incomplete (could not run, or none found)
`);
  process.exit(0);
}

const root = resolve(arg('root', join(homedir(), 'Desktop')));
const only = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const concurrency = Math.max(1, Number(arg('concurrency', 3)) || 3);

if (!existsSync(root)) {
  console.error(`\n  root does not exist: ${root}\n`);
  process.exit(2);
}

function discover() {
  return discoverIn(root, only);
}

function runOne(prop, tmp) {
  return new Promise(resolvePromise => {
    const jsonPath = join(tmp, `${prop.name}.json`);
    const args = [DOCTOR, '--config', prop.config, '--json', jsonPath];
    if (has('repo-only')) args.push('--repo-only');

    const child = spawn(process.execPath, args, { cwd: prop.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', () => {}); // the per-property report is in the JSON
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', err => {
      resolvePromise({ ...prop, status: 'incomplete', error: err.message });
    });
    child.on('close', code => {
      // The JSON is the evidence. A process that exited without writing one has
      // not reported anything, whatever its exit code claimed.
      if (!existsSync(jsonPath)) {
        resolvePromise({
          ...prop,
          status: 'incomplete',
          error: stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `exited ${code} without writing a verdict`,
        });
        return;
      }
      try {
        const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
        resolvePromise({ ...prop, status: report.verdict, report });
      } catch (e) {
        resolvePromise({ ...prop, status: 'incomplete', error: `unreadable verdict: ${e.message}` });
      }
    });
  });
}

/** Small fixed pool: these run live HTTP against real properties. */
async function runAll(props, tmp) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, props.length) }, async () => {
    while (next < props.length) {
      const mine = props[next++];
      process.stderr.write(`  running ${mine.name}\n`);
      results.push(await runOne(mine, tmp));
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

const C = process.stdout.isTTY
  ? { red: s => `\x1b[31m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m` }
  : { red: s => s, green: s => s, dim: s => s, bold: s => s, yellow: s => s };

const props = discover();

if (props.length === 0) {
  console.error(`\n  ${C.yellow('INCOMPLETE')}  no property under ${root} has a doctor.config.json.`);
  console.error(`  Nothing was measured, which is not the same as nothing being wrong.\n`);
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'doctor-portfolio-'));
let results;
try {
  results = await runAll(props, tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(C.bold('  PORTFOLIO SWEEP') + C.dim(`  ${props.length} properties under ${root}`));
console.log('');

const width = Math.max(...results.map(r => r.name.length));
for (const r of results) {
  if (r.status === 'incomplete') {
    console.log(`  ${C.yellow('INCOMPLETE')}  ${r.name.padEnd(width)}  ${C.dim(r.error ?? '')}`);
    continue;
  }
  const c = r.report.counts;
  const waived = r.report.results.filter(x => x.waived).length;
  const mark = r.status === 'pass' ? C.green('PASS      ') : C.red('FAIL      ');
  console.log(
    `  ${mark}  ${r.name.padEnd(width)}  ${c.pass} passed, ${c.fail} failed, ${c.skip} skipped` +
      (waived ? C.yellow(`, ${waived} waived`) : '') +
      C.dim(`   ${r.report.baseUrl ?? ''}`),
  );
}

const failing = results.filter(r => r.status === 'fail');
if (failing.length) {
  console.log('');
  console.log(C.red(C.bold('  Every failing assertion, by property:')));
  for (const r of failing) {
    console.log('');
    console.log(C.red(`  ${r.name}`) + C.dim(`  ${r.report.baseUrl ?? ''}`));
    for (const a of r.report.results.filter(x => x.status === 'fail')) {
      console.log(`    - [${a.id}] ${a.title}: ${a.evidence}`);
    }
  }
}

// Waived is declared debt, not a pass, so it is surfaced portfolio-wide too.
const waivedRows = results.flatMap(r =>
  r.status === 'incomplete' ? [] : r.report.results.filter(x => x.waived).map(x => ({ prop: r.name, ...x })),
);
if (waivedRows.length) {
  console.log('');
  console.log(C.yellow(C.bold('  Waived (declared debt, still broken):')));
  for (const w of waivedRows) console.log(C.yellow(`    - ${w.prop}: [${w.id}] ${w.title}`));
}

const nPass = results.filter(r => r.status === 'pass').length;
const nFail = failing.length;
const nIncomplete = results.filter(r => r.status === 'incomplete').length;

console.log('');
console.log(
  `  ${nFail === 0 && nIncomplete === 0 ? C.green('PASS') : C.red('FAIL')}   ` +
    `${nPass} passed, ${nFail} failed${nIncomplete ? `, ${C.yellow(`${nIncomplete} incomplete`)}` : ''}` +
    ` across ${results.length} properties`,
);
console.log('');

const jsonOut = arg('json');
if (jsonOut) {
  const rollUp = {
    generatedAt: new Date().toISOString(),
    root,
    counts: { properties: results.length, pass: nPass, fail: nFail, incomplete: nIncomplete },
    properties: results.map(r =>
      r.status === 'incomplete'
        ? { name: r.name, status: 'incomplete', error: r.error }
        : {
            name: r.name,
            status: r.status,
            baseUrl: r.report.baseUrl,
            counts: r.report.counts,
            failing: r.report.results.filter(x => x.status === 'fail').map(x => ({ id: x.id, title: x.title, evidence: x.evidence })),
            waived: r.report.results.filter(x => x.waived).map(x => x.id),
          },
    ),
  };
  writeFileSync(resolve(jsonOut), JSON.stringify(rollUp, null, 2));
  console.log(`  roll-up written to ${resolve(jsonOut)}\n`);
}

// Incomplete outranks fail: not knowing is worse than a known bad result.
process.exit(nIncomplete > 0 ? 2 : nFail > 0 ? 1 : 0);
