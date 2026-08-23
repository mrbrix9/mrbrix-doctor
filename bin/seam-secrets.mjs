#!/usr/bin/env node
/**
 * seam-secrets — refuses a commit or a build when a TRACKED file holds a real credential.
 *
 * Scans `git ls-files`, never the working tree: an untracked .env is correct and must not
 * be reported, while a tracked one is the whole finding. Twenty-two live connection
 * strings across three production databases are committed and pushed right now, and the
 * worst offender is a file whose NAME says local and which is tracked anyway.
 *
 * Drop-in, no dependencies:
 *   package.json  "pretest": "seam-secrets"   or a CI step
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isRealCredential } from '../src/seam/invariants/sec1-secrets.mjs';

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const repo = resolve(arg('--repo') ?? process.cwd());

/**
 * TWO patterns for one job, and they are not interchangeable.
 *
 * `git grep -E` speaks POSIX, where `[[:space:]]` is a character class. JavaScript's
 * RegExp does NOT: it reads `[^:/@[:space:]]` as a class of the literal characters
 * `: / @ [ s p a c e` followed by a stray `]`, which then refuses to match any URL
 * containing those letters. Reusing the POSIX string in `new RegExp()` made this guard
 * report a repository with twenty-two committed credentials as CLEAN.
 *
 * A false negative in a security check is the worst outcome available, so the two live
 * side by side with a comment rather than being cleverly shared.
 */
const GREP_PATTERN = 'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@[^/[:space:]"]+';
const JS_PATTERN = /postgres(?:ql)?:\/\/[^:/@\s]+:[^@\s]+@[^/\s"]+/g;

function git(cmdArgs) {
  try {
    return execFileSync('git', ['-C', repo, ...cmdArgs], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return null; }
}

if (git(['rev-parse', '--git-dir']) === null) {
  console.error(`  seam-secrets: ${repo} is not a git repository`);
  process.exit(2);
}

const tracked = git(['ls-files']);
if (tracked === null) {
  // Could not enumerate. Report it rather than passing on an unmeasured repository.
  console.error('  seam-secrets: could not list tracked files; nothing was checked');
  process.exit(2);
}

const hits = git(['grep', '-nE', '--', GREP_PATTERN]) ?? '';
const findings = [];
for (const line of hits.split('\n').filter(Boolean)) {
  const m = /^(.*?):(\d+):(.*)$/.exec(line);
  if (!m) continue;
  const urls = [...m[3].matchAll(JS_PATTERN)].map((x) => x[0]);
  const real = urls.filter(isRealCredential);
  if (real.length) findings.push({ file: m[1], line: Number(m[2]), count: real.length });
}

const scanned = tracked.split('\n').filter(Boolean).length;

if (!findings.length) {
  console.log(`  seam-secrets: clean (${scanned} tracked files)`);
  process.exit(0);
}

const total = findings.reduce((n, f) => n + f.count, 0);
// Distinct FILES, not matching lines. One file with eighteen hits is one file.
const files = [...new Set(findings.map((f) => f.file))];
console.error(`\n  REFUSING: ${total} credentialed connection string(s) in ${files.length} TRACKED file(s)\n`);
for (const file of files) {
  const inFile = findings.filter((f) => f.file === file);
  const n = inFile.reduce((a, f) => a + f.count, 0);
  console.error(`    ${file}  (${n} on ${inFile.length} line${inFile.length === 1 ? '' : 's'})`);
}
console.error('\n  ROTATE those database passwords first, then remove the files.');
console.error('  Deleting them alone changes nothing: the values stay in git history.\n');
process.exit(1);
