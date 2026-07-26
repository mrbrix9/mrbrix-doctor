// Inside facts. A central scanner cannot see any of these, which is why the engine
// runs inside the property (Discipline #19 applied to verification itself).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.vercel', 'coverage', '.turbo', 'out']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const pass = (id, place, title, evidence) => ({ id, place, title, status: 'pass', evidence });
const fail = (id, place, title, evidence) => ({ id, place, title, status: 'fail', evidence });
const skip = (id, place, title, evidence) => ({ id, place, title, status: 'skip', evidence });

function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (IGNORE.has(name) || name.startsWith('.') && name !== '.well-known') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out, depth + 1);
    else if (CODE_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * `prisma db push` in a build command applies unreviewed DDL to whatever database the
 * deployment points at, with no migration file and no rollback path.
 */
function checkNoDbPushInBuild(root, results) {
  const pkg = readJson(join(root, 'package.json'));
  if (!pkg) { results.push(skip('repo.db-push', 2, 'build command DDL safety', 'no package.json')); return; }
  const scripts = pkg.scripts ?? {};
  const offenders = Object.entries(scripts).filter(([, v]) => /db\s+push|db:push/i.test(String(v)));
  const buildOffenders = offenders.filter(([k]) => /build|deploy|postinstall|vercel/i.test(k));
  if (buildOffenders.length) {
    results.push(fail('repo.db-push', 2, 'no schema push in a build or deploy command', buildOffenders.map(([k, v]) => `${k}: ${v}`).join(' | ') + ' — this applies unreviewed DDL to the deployed database with no migration file and no rollback'));
  } else if (offenders.length) {
    results.push(pass('repo.db-push', 2, 'no schema push in a build or deploy command', `db push present only in non-build scripts (${offenders.map(([k]) => k).join(', ')})`));
  } else {
    results.push(pass('repo.db-push', 2, 'no schema push in a build or deploy command', 'no db push in any script'));
  }
}

function checkMigrationsExist(root, results) {
  const schema = ['prisma/schema.prisma', 'schema.prisma'].map(p => join(root, p)).find(existsSync);
  if (!schema) { results.push(skip('repo.migrations', 2, 'migration history', 'no prisma schema in this repo')); return; }
  const dir = join(root, 'prisma', 'migrations');
  if (!existsSync(dir)) {
    results.push(fail('repo.migrations', 2, 'migration history exists', 'prisma/migrations/ absent while a schema is present; schema changes have no reviewable history'));
    return;
  }
  const count = readdirSync(dir).filter(n => !n.startsWith('.') && n !== 'migration_lock.toml').length;
  if (count === 0) results.push(fail('repo.migrations', 2, 'migration history exists', 'prisma/migrations/ is empty'));
  else results.push(pass('repo.migrations', 2, 'migration history exists', `${count} migrations`));
}

/**
 * Playbook §6.2: model access goes through the gateway wrapper so the provider stays a
 * config value. A direct SDK import outside the wrapper is the dependency the doctrine says
 * we do not have. T1 is the known live violation.
 */
function checkGatewayDiscipline(root, cfg, results) {
  const patterns = cfg.providerSdkPatterns ?? ['@anthropic-ai/sdk', 'openai', '@google/generative-ai', '@aws-sdk/client-bedrock'];
  const allow = (cfg.gatewayAllowPaths ?? ['lib/ai', 'src/lib/ai', 'packages/ai', 'lib/gateway']).map(p => p.replace(/\\/g, '/'));
  const files = walk(root);
  if (files.length === 0) { results.push(skip('repo.gateway', 6, 'AI gateway discipline', 'no source files found')); return; }
  const violations = [];
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/');
    if (allow.some(a => rel.startsWith(a))) continue;
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const p of patterns) {
      const re = new RegExp(`(?:from|require\\()\\s*['"]${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/[^'"]*)?['"]`);
      if (re.test(src)) violations.push(`${rel} imports ${p}`);
    }
  }
  if (violations.length) {
    results.push(fail('repo.gateway', 6, 'no provider SDK outside the gateway wrapper', violations.slice(0, 10).join(' | ') + (violations.length > 10 ? ` | +${violations.length - 10} more` : '') + ' — §6.2 makes the provider a config value; a direct import is a hard dependency'));
  } else {
    results.push(pass('repo.gateway', 6, 'no provider SDK outside the gateway wrapper', `${files.length} source files scanned, allowed paths: ${allow.join(', ')}`));
  }
}

/**
 * The assertion the portfolio most needs and currently has nowhere: proof that an AI surface
 * returns absence rather than a plausible value, and refuses outside its authority.
 */
function checkGoldenSet(root, cfg, results) {
  const surfaces = cfg.aiSurfaces ?? [];
  if (surfaces.length === 0) { results.push(skip('repo.golden-set', 7, 'AI surface golden set', 'no aiSurfaces declared in doctor config')); return; }
  for (const s of surfaces) {
    const p = join(root, s.goldenSet ?? '');
    if (!s.goldenSet || !existsSync(p)) {
      results.push(fail('repo.golden-set', 7, `golden set for "${s.name}"`, `${s.goldenSet || '(not configured)'} not found; nothing proves this surface obeys the no-fabrication rule`));
      continue;
    }
    const set = readJson(p);
    const cases = Array.isArray(set) ? set : set?.cases ?? [];
    const traps = cases.filter(c => c.expect === 'absence').length;
    const abstentions = cases.filter(c => c.expect === 'refuse-and-point').length;
    if (traps === 0 || abstentions === 0) {
      results.push(fail('repo.golden-set', 7, `golden set for "${s.name}" covers both failure modes`, `${cases.length} cases, ${traps} fabrication traps, ${abstentions} abstention cases; both must be non-zero`));
    } else {
      results.push(pass('repo.golden-set', 7, `golden set for "${s.name}"`, `${cases.length} cases, ${traps} fabrication traps, ${abstentions} abstention cases`));
    }
  }
}

function checkSpendCeiling(root, cfg, results) {
  if (!cfg.aiSurfaces?.length) { results.push(skip('repo.spend-ceiling', 6, 'inference spend ceiling', 'no AI surfaces declared')); return; }
  if (typeof cfg.monthlyInferenceCeilingUsd === 'number' && cfg.monthlyInferenceCeilingUsd > 0) {
    results.push(pass('repo.spend-ceiling', 6, 'inference spend ceiling declared', `$${cfg.monthlyInferenceCeilingUsd}/month`));
  } else {
    results.push(fail('repo.spend-ceiling', 6, 'inference spend ceiling declared', 'monthlyInferenceCeilingUsd absent; an unwatched automation has already consumed a month of spend once'));
  }
}

export function runRepoChecks(root, cfg, { skipGoldenSetPresence = false } = {}) {
  const results = [];
  checkNoDbPushInBuild(root, results);
  checkMigrationsExist(root, results);
  checkGatewayDiscipline(root, cfg, results);
  // When --evals is on, the executing runner supersedes this presence-only check.
  if (!skipGoldenSetPresence) checkGoldenSet(root, cfg, results);
  checkSpendCeiling(root, cfg, results);
  return results;
}
