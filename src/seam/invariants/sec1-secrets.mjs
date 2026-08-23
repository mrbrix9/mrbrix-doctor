/**
 * SEC-1 — no tracked file holds a credentialed connection string.
 *
 * Exists because: twenty-one live connection strings across three production databases are
 * committed and pushed. The worst offender is a file whose NAME says local
 * (.claude/settings.local.json) and which is tracked anyway — the name is doing the work
 * that .gitignore should be doing.
 *
 * Scans `git ls-files`, never the working tree. An untracked .env is correct and must not
 * be reported; a tracked one is the failure.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SEC-1';
const TITLE = 'No tracked file holds a credentialed connection string';
const SCOPE = 'git · every repo';

/** Real credential vs example. Placeholders and localhost are not leaks. */
export function isRealCredential(url) {
  const m = /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/\s]+)/.exec(String(url));
  if (!m) return false;
  const [, user, pass, host] = m;
  if (/^(localhost|127\.0\.0\.1|host|db|postgres)(:\d+)?$/i.test(host)) return false;
  if (/^(user|username|youruser|pass|password|yourpassword|xxx+)$/i.test(user)) return false;
  if (/^(pass|password|yourpassword|secret|xxx+|changeme)$/i.test(pass)) return false;
  if (/x{3,}/i.test(host)) return false;
  return true;
}

/** data = { findings: [{repo, file, count, hosts:[]}], filesScanned } */
export function evaluate(data) {
  const empty = requireSample(data?.filesScanned, { id: ID, title: TITLE, scope: SCOPE, what: 'tracked files' });
  if (empty) return empty;

  const f = data.findings ?? [];
  if (f.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: 'no credentialed connection string in ' + data.filesScanned + ' tracked files' });
  }
  const total = f.reduce((n, x) => n + x.count, 0);
  const hosts = [...new Set(f.flatMap((x) => x.hosts ?? []))];
  const repos = [...new Set(f.map((x) => x.repo))];
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: total + ' credentialed strings in ' + f.length + ' tracked file(s) across ' + repos.join(', ') + '; ' + hosts.length + ' distinct database host(s)',
    fix: 'ROTATE those database passwords first, then remove the files. Deleting them changes nothing on its own because the values remain in git history.',
  });
}

export async function measure(ctx) { return ctx.scanTrackedSecrets(); }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'local', measure, evaluate };
