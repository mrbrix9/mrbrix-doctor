#!/usr/bin/env node
/**
 * seam-guard — run before a deploy. Refuses when the directory is a known foot-gun.
 *
 *   seam-guard                 check the current directory
 *   seam-guard --dir <path>
 *   seam-guard --force         report but do not block
 *
 * Wire it as a predeploy script:  "predeploy": "seam-guard"
 */
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { inspect, assess, formatRefusal } from '../src/seam/guard.mjs';

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const dir = resolve(arg('--dir') ?? process.cwd());
const root = resolve(arg('--root') ?? resolve(homedir(), 'Desktop'));
const force = args.includes('--force');

const verdict = assess(inspect(dir, { root }));

if (verdict.ok) {
  console.log(`  seam-guard: ok to deploy ${verdict.project ? `"${verdict.project}"` : ''} from ${verdict.dir}`);
  process.exit(0);
}

console.error('\n' + formatRefusal(verdict) + '\n');
process.exit(force ? 0 : 1);
