import { runLiveChecks } from './checks/live.mjs';
import { runRepoChecks } from './checks/repo.mjs';
import { runAllGoldenSets } from './checks/golden.mjs';

const PLACES = {
  1: 'Vercel (it runs)',
  2: 'Postgres home (it remembers)',
  3: 'Analytics (it is measured)',
  4: 'Search Console (it is found)',
  5: 'CMS (it is editable)',
  6: 'T1 (it is felt)',
  7: 'Agent Presence (it is trusted)',
};

export async function runDoctor({ root, config, skipLive = false, skipRepo = false, withEvals = false }) {
  const results = [];
  if (!skipRepo) results.push(...runRepoChecks(root, config, { skipGoldenSetPresence: withEvals }));
  if (withEvals) results.push(...(await runAllGoldenSets(root, config)));
  if (!skipLive) results.push(...(await runLiveChecks(config)));

  const failed = results.filter(r => r.status === 'fail');
  const passed = results.filter(r => r.status === 'pass');
  const skipped = results.filter(r => r.status === 'skip');

  return {
    schema: 'mrbrix.proprioception/1',
    property: config.property,
    baseUrl: config.baseUrl,
    verdict: failed.length === 0 ? 'pass' : 'fail',
    counts: { pass: passed.length, fail: failed.length, skip: skipped.length },
    results,
  };
}

const C = process.stdout.isTTY
  ? { red: s => `\x1b[31m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m` }
  : { red: s => s, green: s => s, dim: s => s, bold: s => s, yellow: s => s };

export function printReport(report) {
  const byPlace = new Map();
  for (const r of report.results) {
    if (!byPlace.has(r.place)) byPlace.set(r.place, []);
    byPlace.get(r.place).push(r);
  }
  console.log('');
  console.log(C.bold(`  ${report.property}`) + C.dim(`  ${report.baseUrl}`));
  console.log(C.dim(`  proprioception per Playbook v1.15 §5.9 / Discipline #22`));
  console.log('');
  for (const place of [...byPlace.keys()].sort()) {
    const rows = byPlace.get(place);
    const bad = rows.filter(r => r.status === 'fail').length;
    const head = `  Place ${place} — ${PLACES[place] ?? 'other'}`;
    console.log(bad ? C.red(C.bold(head)) : C.bold(head));
    for (const r of rows) {
      const mark = r.status === 'pass' ? C.green('pass') : r.status === 'fail' ? C.red('FAIL') : C.yellow('skip');
      console.log(`    ${mark}  ${r.title}`);
      // The evidence IS the receipt. A verdict without it is a claim, which is the thing being replaced.
      console.log(C.dim(`          ${r.evidence}`));
    }
    console.log('');
  }
  const { pass, fail, skip } = report.counts;
  const line = `  ${fail === 0 ? C.green('PASS') : C.red('FAIL')}   ${pass} passed, ${fail} failed, ${skip} skipped`;
  console.log(line);
  if (fail > 0) {
    console.log('');
    console.log(C.red('  Failing assertions:'));
    for (const r of report.results.filter(r => r.status === 'fail')) console.log(`    - [${r.id}] ${r.title}: ${r.evidence}`);
  }
  console.log('');
}
