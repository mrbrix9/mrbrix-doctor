#!/usr/bin/env node
/**
 * Seam Doctor CLI. Read-only: it measures, it never writes.
 * Exit code is the verdict, matching Doctor's existing contract.
 *
 *   seam-doctor              both runners
 *   seam-doctor --runner t1  live + database only
 *   seam-doctor --runner local
 *   seam-doctor --only SEAM-1,SIG-5
 *   seam-doctor --json
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { makeQuery, readEnvValue, runSeamDoctor, printReport, verdictOf, exitCodeOf } from '../src/seam/run.mjs';
import { makeLocalContext } from '../src/seam/local.mjs';
import { beatFrom, writeBeat } from '../src/seam/heartbeat.mjs';
import { makeCiContext } from '../src/seam/ci.mjs';

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const only = arg('--only')?.split(',') ?? null;
const wanted = arg('--runner');
const asJson = args.includes('--json');

const home = homedir();
const root = resolve(home, 'Desktop');

const BRANDED_DOMAINS = [
  'mrbrix.com', 'identity.mrbrix.com', 'textayo.com', 'majors.pro', 'grand.tennis',
  'courts.tennis', 'thegrand.nyc', 'visdx.com', 'mxta.org', 'fullthrottle.mx',
  'trackpass.mx', 'motoverse.mx', 'motobot.ai', 'mototerra.mx', 'metropulos.co',
  'audriana.com', 'basicinstinct.ai', 'nikkimike.com', 'report.claims', 'adjust.claims',
  'insure.claims', 'watchzoe.com',
];

const results = [];

if (!wanted || wanted === 't1') {
  const db = readEnvValue(resolve(home, 'Desktop/nikkimike/.env'), 'DATABASE_URL');
  if (!db) {
    console.error('No DATABASE_URL found; skipping the t1 runner.');
  } else {
    const r = await runSeamDoctor({
      runner: 't1', now: new Date(), query: makeQuery(db),
      secrets: {
        connectorEncKey:
          readEnvValue(resolve(home, 'Desktop/T1/.env.local'), 'CONNECTOR_ENC_KEY') ||
          readEnvValue(resolve(home, 'Desktop/T1/.env'), 'CONNECTOR_ENC_KEY'),
        // The fallback both services actually use. Without it, an environment correctly
        // running on JWT_SECRET reports a key mismatch that does not exist.
        jwtSecret: readEnvValue(resolve(home, 'Desktop/nikkimike/.env.local'), 'JWT_SECRET'),
      },
    }, { only });
    results.push(...r.results);
  }
}

if (!wanted || wanted === 'local') {
  const r = await runSeamDoctor(
    { ...makeLocalContext({ root, domains: BRANDED_DOMAINS }) },
    { only }
  );
  results.push(...r.results);
}

if (!wanted || wanted === 'ci') {
  const r = await runSeamDoctor(makeCiContext({
    root,
    schemaPairs: [{
      owner: resolve(root, 'nikkimike/prisma/schema.prisma'), ownerName: 'nikkimike',
      rider: resolve(root, 'textayo-app/prisma/schema.prisma'), riderName: 'textayo-app',
    }],
  }), { only });
  results.push(...r.results);
}

const report = {
  ranAt: new Date().toISOString(),
  verdict: verdictOf(results),
  counts: {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
  },
  results,
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else printReport(report);

// Record that this ran. Written here and never read here: `seam-watch` is a separate
// process because a component cannot report its own absence.
// The T1 sink is opt-in. Building an instrument is not the same as deciding to write to
// production with it, so --emit-t1 has to be asked for.
if (!args.includes('--no-beat')) {
  const beatFile = arg('--beat-file') ?? resolve(home, '.mrbrix', 'seam-heartbeat.json');
  try {
    const n = writeBeat(beatFile, beatFrom(report));
    if (!asJson) console.log('  \x1b[2mheartbeat recorded (' + n + ' kept) -> ' + beatFile + '\x1b[0m\n');
  } catch (err) {
    console.error('  could not record heartbeat: ' + err.message);
  }
}
if (args.includes('--emit-t1')) {
  console.error('  --emit-t1 is not wired yet: writing to the production event store needs an explicit decision, not a flag I added.');
}

process.exit(exitCodeOf(report.verdict));
