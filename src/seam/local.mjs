/**
 * Local runner context. Supplies the IO the local invariants need.
 *
 * Every function here is injectable, so the invariants are tested with crafted data and
 * this file is the only part that touches the machine.
 *
 * Performance matters here for an unglamorous reason: a check nobody runs because it takes
 * three minutes is a check that does not exist. Domains are probed in parallel and the
 * secret scan uses one `git grep` per repository rather than one `grep` per tracked file.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLinks } from './links.mjs';
import { isRealCredential } from './invariants/sec1-secrets.mjs';

function sh(cmd, args, opts = {}) {
  try {
    // stderr is piped, not inherited: a `git remote` in a non-repo directory is an
    // EXPECTED answer here (SUR-2 is asking exactly that), and letting it print makes a
    // healthy run look like it errored.
    return execFileSync(cmd, args, {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], ...opts,
    }).trim();
  } catch { return null; }
}

/** Find BOTH link formats. A project.json-only sweep misses live links. */
export function findLinkPaths(root) {
  const out = sh('find', [root, '-maxdepth', '5', '(', '-name', 'project.json', '-o', '-name', 'repo.json', ')',
    '-path', '*/.vercel/*', '-not', '-path', '*/node_modules/*']);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function makeLocalContext({ root, domains = [] }) {
  let cachedLinks = null;

  const listLinks = async ({ withBuildable = false, withRemote = false } = {}) => {
    if (!cachedLinks) cachedLinks = readLinks(findLinkPaths(root));
    return cachedLinks.map((l) => ({
      ...l,
      ...(withBuildable ? { buildable: existsSync(join(l.dir, 'package.json')) } : {}),
      ...(withRemote ? { remote: sh('git', ['-C', l.dir, 'remote', 'get-url', 'origin']) } : {}),
    }));
  };

  /**
   * The project list PAGINATES at 20 and the response carries a `pagination.next` cursor.
   * Reading only the first page made eight live projects look deleted and produced a
   * confident, wrong accusation against real deployments. Follow the cursor to the end,
   * and report whether the listing actually completed so the check can refuse to accuse
   * on a partial list.
   */
  const listProjects = async () => {
    const ids = [];
    let cursor = null;
    for (let page = 0; page < 20; page++) {
      const args = ['projects', 'ls', '--json'];
      if (cursor) args.push('--next', String(cursor));
      const out = sh('vercel', args);
      if (!out) return { ids, complete: false };
      let j;
      try { j = JSON.parse(out); } catch { return { ids, complete: false }; }
      const arr = Array.isArray(j) ? j : (j.projects ?? []);
      ids.push(...arr.map((p) => p.id).filter(Boolean));
      cursor = j?.pagination?.next ?? null;
      if (!cursor) return { ids, complete: true };
    }
    return { ids, complete: false }; // ran out of pages; treat as untrusted
  };

  const listProjectIds = async () => (await listProjects()).ids;

  /**
   * All domains at once, but each probe must emit exactly ONE atomic line.
   *
   * A first version backgrounded `printf` and `curl` separately with `&`. Their writes
   * interleaved, every line failed to parse, and the check reported all twenty-two domains
   * as unresolvable — a total false alarm from a healthy portfolio. `xargs -P` with one
   * `echo` per domain keeps each line whole.
   */
  const probeDomains = async () => {
    if (!domains.length) return [];
    // Domains arrive on stdin so nothing has to be quoted into a nested shell string. An
    // earlier version built one big `sh -c` and the quoting mangled every probe, which the
    // empty-sample guard then correctly refused to call a result.
    const INNER = 'r=$(curl -s -o /dev/null -L --max-time 15 -w "%{http_code} %{url_effective}" "https://$1" 2>/dev/null) || r="0 -"; echo "$1 $r"';
    let out = '';
    try {
      out = execFileSync('xargs', ['-P', '8', '-I', '{}', 'sh', '-c', INNER, '_', '{}'], {
        input: domains.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      });
    } catch { out = ''; }

    const seen = new Map();
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const [domain, code, url] = parts;
      const status = parseInt(code, 10) || 0;
      let finalHost = null;
      try { finalHost = new URL(url).hostname; } catch { /* leave null */ }
      seen.set(domain, { domain, resolved: status !== 0, status, finalHost });
    }
    // Nothing parseable means the probe itself failed. Return an empty sample so the check
    // SKIPS, rather than reporting a healthy portfolio as entirely dark.
    if (seen.size === 0) return [];
    return domains.map((d) => seen.get(d) ?? { domain: d, resolved: false, status: 0, finalHost: null });
  };

  const scanTrackedSecrets = async () => {
    const repos = (sh('find', [root, '-maxdepth', '3', '-name', '.git', '-not', '-path', '*/node_modules/*']) || '')
      .split('\n').filter(Boolean).map((g) => g.replace(/\/\.git$/, ''));
    const findings = [];
    let filesScanned = 0;
    const PATTERN = 'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@[^/[:space:]"]+';
    for (const repo of repos) {
      const listed = sh('git', ['-C', repo, 'ls-files']);
      if (listed === null) continue;
      filesScanned += listed.split('\n').filter(Boolean).length;
      // One call per repo, over tracked files only. An untracked .env is correct and must
      // not be reported; a tracked one is the finding.
      const hits = sh('git', ['-C', repo, 'grep', '-hoE', '--', PATTERN]);
      if (!hits) continue;
      const byFile = sh('git', ['-C', repo, 'grep', '-loE', '--', PATTERN]);
      const files = byFile ? byFile.split('\n').filter(Boolean) : [];
      for (const f of files) {
        const perFile = sh('git', ['-C', repo, 'grep', '-hoE', '--', PATTERN, 'HEAD', '--', f])
          ?? sh('git', ['-C', repo, 'grep', '-hoE', '--', PATTERN, '--', f]);
        const urls = (perFile ?? '').split('\n').filter(Boolean).map((u) => u.replace(/^HEAD:[^:]*:/, ''));
        const real = urls.filter(isRealCredential);
        if (!real.length) continue;
        findings.push({
          repo: repo.split('/').pop(),
          file: f,
          count: real.length,
          hosts: [...new Set(real.map((u) => (/@([^/\s]+)/.exec(u) || [])[1]).filter(Boolean))],
        });
      }
    }
    return { findings, filesScanned };
  };

  return { runner: 'local', now: new Date(), listLinks, listProjects, listProjectIds, probeDomains, scanTrackedSecrets };
}
