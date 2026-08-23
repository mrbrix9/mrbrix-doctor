#!/usr/bin/env node
/**
 * seam-watch — reads the heartbeat and judges it. Runs NO checks.
 *
 * This is a separate binary on purpose. It must be able to report that the Seam Doctor is
 * dead, which a process inside the Seam Doctor cannot do. Exit code is the verdict:
 *   0 live and healthy   1 failing or stale   2 incomplete
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readBeats, assessFreshness, boardLine } from '../src/seam/heartbeat.mjs';

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const path = arg('--file') ?? resolve(homedir(), '.mrbrix', 'seam-heartbeat.json');
const intervalMinutes = Number(arg('--interval') ?? 360);

const freshness = assessFreshness(readBeats(path), { intervalMinutes });
const line = boardLine(freshness);

const colour = line.severity === 'critical' ? '\x1b[31m' : line.severity === 'warning' ? '\x1b[33m' : '\x1b[32m';
if (args.includes('--json')) {
  console.log(JSON.stringify({ ...freshness, board: line }, null, 2));
} else {
  console.log('\n  ' + colour + line.text + '\x1b[0m');
  console.log('  \x1b[2m' + freshness.evidence + '\x1b[0m\n');
}

process.exit(line.severity === 'critical' ? 1 : line.severity === 'warning' ? 2 : 0);
