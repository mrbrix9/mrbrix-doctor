/**
 * CI runner context — the cross-repo measurements.
 *
 * These are the checks no single repository can perform on itself: comparing a schema to
 * its owner, hashing every copy of a package, dialling the hosts baked into source.
 *
 * PERFORMANCE IS A CORRECTNESS PROPERTY HERE. A first version walked all of ~/Desktop and
 * took over three minutes, which means it would have been run once and then never again.
 * Everything now goes through `git grep` over TRACKED files inside known repositories:
 * roughly a hundred times faster, and it also scopes the answer correctly, since an
 * untracked scratch file is not part of any repo's behaviour.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], ...opts,
    }).trim();
  } catch { return null; }
}

const sha = (path) => {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16); }
  catch { return null; }
};

/** Every git repository directly under the root, plus one nesting level. */
export function findRepos(root) {
  const out = sh('find', [root, '-maxdepth', '3', '-name', '.git', '-not', '-path', '*/node_modules/*']) ?? '';
  return out.split('\n').filter(Boolean).map((g) => g.replace(/\/\.git$/, ''));
}

export function makeCiContext({ root, schemaPairs = [] }) {
  let repos = null;
  const allRepos = () => (repos ??= findRepos(root));

  /** `git grep` across every repo, tracked files only. Returns `repo\0file:line:text`. */
  const grepRepos = (args) => {
    const lines = [];
    for (const repo of allRepos()) {
      const out = sh('git', ['-C', repo, 'grep', ...args]);
      if (!out) continue;
      for (const l of out.split('\n').filter(Boolean)) lines.push({ repo, line: l });
    }
    return lines;
  };

  const readFile = async (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

  const findVendoredTarballs = async () => {
    const files = [];
    for (const repo of allRepos()) {
      const out = sh('git', ['-C', repo, 'ls-files', '--', '*.tgz']);
      const tracked = out ? out.split('\n').filter(Boolean) : [];
      // Vendored tarballs are often gitignored, so also look in the conventional folder.
      const vendored = sh('find', [repo + '/vendor', repo + '/apps', repo + '/packages',
        '-maxdepth', '3', '-name', '*.tgz', '-not', '-path', '*/node_modules/*']) ?? '';
      for (const rel of tracked) files.push(repo + '/' + rel);
      for (const abs of vendored.split('\n').filter(Boolean)) files.push(abs);
    }
    return [...new Set(files)]
      .filter((p) => /mrbrix|motoverse/i.test(p.split('/').pop()))
      .map((p) => ({ path: p, sha: sha(p) }))
      .filter((f) => f.sha);
  };

  /** Hosts baked in as a default: `?? "https://…"` or `|| "https://…"`. */
  const probeCodeHosts = async () => {
    const hits = grepRepos(['-nE', '--', '(\\?\\?|\\|\\|)[[:space:]]*"https://[a-z0-9.-]+"']);
    const byUrl = new Map();
    for (const h of hits) {
      const url = (/"(https:\/\/[a-z0-9.-]+)"/.exec(h.line) || [])[1];
      if (!url || /example\.com|localhost/.test(url)) continue;
      const file = h.repo.split('/').pop() + '/' + h.line.split(':')[0];
      if (!byUrl.has(url)) byUrl.set(url, new Set());
      byUrl.get(url).add(file);
    }
    const urls = [...byUrl.keys()];
    if (!urls.length) return [];

    const INNER = 'c=$(curl -s -o /dev/null -L --max-time 12 -w "%{http_code}" "$1" 2>/dev/null) || c=0; echo "$1 $c"';
    let out = '';
    try {
      out = execFileSync('xargs', ['-P', '8', '-I', '{}', 'sh', '-c', INNER, '_', '{}'],
        { input: urls.join('\n') + '\n', encoding: 'utf8', timeout: 90000 });
    } catch { out = ''; }

    const statuses = new Map();
    for (const line of out.split('\n')) {
      const [url, code] = line.trim().split(/\s+/);
      if (url) statuses.set(url, parseInt(code, 10) || 0);
    }
    // Nothing measured means the probe failed; return an empty sample so the check SKIPS
    // rather than declaring every service host dead.
    if (!statuses.size) return [];
    return urls.map((u) => ({ url: u, status: statuses.get(u) ?? 0, sources: [...byUrl.get(u)] }));
  };

  /**
   * Tables written by an insert, and whether any query reads them.
   *
   * Two bugs worth naming, both found by running it rather than reading it:
   *   - `[a-z_]+` excludes DIGITS, so `t1_pulse` matched as `t`. The write-only table this
   *     check exists for was the one table it could not see.
   *   - `insert into the …` appears in prose. Comment lines are excluded and a match must
   *     look like an identifier, or the report fills up with English words.
   */
  const scanStores = async () => {
    const TABLE = '[a-z][a-z0-9_]*';
    const isProse = (line) => /^\s*(\/\/|\*|#)/.test(line);
    const looksLikeTable = (t) => /_/.test(t) || /^t\d/.test(t);

    const stores = new Map();
    for (const w of grepRepos(['-nE', '--', 'insert into ' + TABLE])) {
      const m = /^(.*?):(\d+):(.*)$/.exec(w.line);
      if (!m || isProse(m[3])) continue;
      const t = (new RegExp('insert into (' + TABLE + ')').exec(m[3]) || [])[1];
      if (!t || !looksLikeTable(t)) continue;
      if (!stores.has(t)) stores.set(t, { table: t, writes: 0, reads: 0, rows: null });
      stores.get(t).writes++;
    }
    if (!stores.size) return [];

    // ONE pass for every read, rather than one grep per table across every repo. The
    // previous form ran hundreds of subprocesses and took minutes, which is the same as
    // not running at all.
    for (const r of grepRepos(['-nE', '--', '(from|join|update) ' + TABLE])) {
      const m = /^(.*?):(\d+):(.*)$/.exec(r.line);
      if (!m || isProse(m[3])) continue;
      for (const hit of m[3].matchAll(new RegExp('(?:from|join|update) (' + TABLE + ')', 'g'))) {
        const rec = stores.get(hit[1]);
        if (rec) rec.reads++;
      }
    }
    return [...stores.values()];
  };

  /** `env.SHARED || env.LOCAL` inside anything deriving a key. */
  const scanSecretFallbacks = async () => {
    const hits = grepRepos(['-nE', '--',
      'process\\.env\\.[A-Z_]*(KEY|SECRET)[A-Z_]*[[:space:]]*\\|\\|[[:space:]]*process\\.env\\.[A-Z_]+']);
    let filesScanned = 0;
    for (const repo of allRepos()) {
      const listed = sh('git', ['-C', repo, 'ls-files']);
      if (listed) filesScanned += listed.split('\n').filter(Boolean).length;
    }
    const sites = hits.map((h) => {
      const m = /^(.*?):(\d+):(.*)$/.exec(h.line);
      return m ? { file: h.repo.split('/').pop() + '/' + m[1], line: Number(m[2]), expression: m[3].trim().slice(0, 120) } : null;
    }).filter(Boolean);
    return { sites, filesScanned };
  };

  return { runner: 'ci', now: new Date(), schemaPairs, readFile, findVendoredTarballs, probeCodeHosts, scanStores, scanSecretFallbacks };
}
