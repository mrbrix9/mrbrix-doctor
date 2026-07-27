// Self-model generator. Playbook §5.8.3, Build Discipline #20.
//
// "Generated at build from the code, never hand-maintained. A hand-written self-model is
// a lie with a timestamp."
//
// So this file is strict about which half is which:
//
//   DERIVED    read from the repository. Cannot be wrong without the repo being wrong.
//   DECLARED   read from doctor.config.json `self`. Editorial, and impossible to derive:
//              what a property is FOR, and what it is deliberately NOT authoritative on.
//
// Anything neither derived nor declared is emitted as "undeclared" rather than guessed.
// A guess here is exactly the fabrication the portfolio's loudest rule forbids.

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.vercel', 'coverage', '.turbo', 'out']);

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function walkDirs(dir, out = [], depth = 0) {
  if (depth > 10) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) { out.push(full); walkDirs(full, out, depth + 1); }
  }
  return out;
}

/** Find the app-router root, whichever layout this property uses. */
function appRoot(root) {
  for (const c of ['src/app', 'app']) if (existsSync(join(root, c))) return join(root, c);
  return null;
}

/** Every route handler that exists on disk. Used to FALSIFY claims, never to publish a list. */
function routesOnDisk(root) {
  const paths = new Set();
  const app = appRoot(root);
  if (app) {
    for (const d of walkDirs(app)) {
      if (!['route.ts', 'route.js', 'route.tsx'].some(f => existsSync(join(d, f)))) continue;
      paths.add('/' + relative(app, d).split('/').filter(s => !(s.startsWith('(') && s.endsWith(')'))).join('/'));
    }
  }
  const apiDir = join(root, 'api'); // static hosts keep functions here, not in the app router
  if (existsSync(apiDir)) {
    const walk = d => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|js|mjs)$/.test(e.name)) paths.add('/api/' + relative(apiDir, full).replace(/\.(ts|js|mjs)$/, ''));
      }
    };
    walk(apiDir);
  }
  return paths;
}

/**
 * Capabilities are DECLARED, and derivation is used only to refute them.
 *
 * Two reasons this is not a filesystem dump. First, §5.8.4 capabilities are the
 * AGENT-facing surface, and an app's internal routes are not that; publishing them at a
 * public well-known URL is information disclosure with no upside. Second, Discipline
 * #21(a) says assert only what traces to a source, so every declared capability is
 * checked against the code and the build fails if it does not exist. A property cannot
 * advertise a capability it does not have.
 */
function resolveCapabilities(root, declared) {
  const onDisk = routesOnDisk(root);
  const caps = [];
  const phantom = [];
  for (const c of declared ?? []) {
    if (c.path && !onDisk.has(c.path)) phantom.push(c.path);
    caps.push({ path: c.path, tier: c.tier ?? 'public', description: c.description ?? null });
  }
  return { caps: caps.sort((a, b) => String(a.path).localeCompare(String(b.path))), phantom };
}

/** DERIVED: what this property depends on, inferred from real package entries only. */
function deriveDependsOn(pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const map = [
    [/^@prisma\/client$|^prisma$/, 'postgres'],
    [/^@neondatabase\//, 'postgres (neon)'],
    [/^stripe$/, 'payments'],
    [/^twilio$/, 'carrier sms and voice'],
    [/^@anthropic-ai\/sdk$|^openai$/, 'model provider'],
    [/^@vercel\/blob$/, 'object storage'],
    [/identity-sdk|@mrbrix\/identity/, 'mrbrix identity'],
    [/@mrbrix\/sense|mrbrix-sense/, 'mrbrix sense'],
    [/ayo-sdk|@mrbrix\/ayo/, 'mrbrix ayo'],
  ];
  const found = new Set();
  for (const name of Object.keys(deps)) for (const [re, label] of map) if (re.test(name)) found.add(label);
  return [...found].sort();
}

/** DERIVED: is this property actually wired to the nervous system, or does it just claim to be. */
function deriveSense(root, pkg) {
  const deps = { ...(pkg?.dependencies ?? {}) };
  const hasPkg = Object.keys(deps).some(n => /@mrbrix\/sense|mrbrix-sense/.test(n));
  const hasEmit = ['src/lib/t1/emit.ts', 'lib/t1/emit.ts', 'src/lib/sense', 'lib/sense']
    .some(p => existsSync(join(root, p)));
  const classes = [];
  if (hasPkg) classes.push('reflex', 'signal', 'sensation');
  else if (hasEmit) classes.push('signal');
  return { emitting: classes.length > 0, classes, via: hasPkg ? '@mrbrix/sense' : hasEmit ? 'direct emitter' : null };
}

/** DERIVED: which public surfaces exist on disk. */
function deriveSurfaces(root, baseUrl) {
  const app = appRoot(root);
  const has = p => existsSync(join(root, p));
  return {
    public: baseUrl ?? null,
    agent: app && existsSync(join(app, 'api/agent')) ? `${baseUrl ?? ''}/api/agent` : null,
    health: app && existsSync(join(app, 'api/health')) ? `${baseUrl ?? ''}/api/health` : null,
    rehearsal: app && existsSync(join(app, 'api/rehearsal')) ? `${baseUrl ?? ''}/api/rehearsal/run` : null,
  };
}

export function buildSelfModel(root, cfg) {
  const pkg = readJson(join(root, 'package.json'));
  const declared = cfg.self ?? {};
  const missing = ['purpose', 'realm', 'owns', 'authoritative_on', 'not_authoritative_on']
    .filter(k => declared[k] === undefined || (Array.isArray(declared[k]) && declared[k].length === 0));

  const { caps, phantom } = resolveCapabilities(root, declared.capabilities);

  const model = {
    schema: 'mrbrix.self/1',
    _generated: 'by @mrbrix/doctor from the repository. Do not hand-edit; edit doctor.config.json `self` instead.',
    generated_at: new Date().toISOString(),

    // derived
    property: cfg.property,
    name: declared.name ?? pkg?.name ?? cfg.property,
    surfaces: deriveSurfaces(root, cfg.baseUrl),
    capabilities: caps,
    depends_on: deriveDependsOn(pkg),
    sense: deriveSense(root, pkg),

    // declared
    purpose: declared.purpose ?? null,
    realm: declared.realm ?? null,
    tier: declared.tier ?? null,
    owns: declared.owns ?? [],
    authoritative_on: declared.authoritative_on ?? [],
    not_authoritative_on: declared.not_authoritative_on ?? [],

    // honest about what cannot yet be signed
    attestation: {
      status: 'unsigned',
      reason: 'Identity hybrid signing (Ed25519 + ML-DSA-65, Discipline #8) is not yet available. Portfolio membership is asserted here and not yet cryptographically verifiable.',
    },
  };

  return { model, missing, phantom };
}

export function writeSelfModel(root, cfg, { strict = true } = {}) {
  const { model, missing, phantom } = buildSelfModel(root, cfg);
  if (strict && phantom.length) {
    throw new Error(
      `self-model declares capabilities that do not exist in this repository: ${phantom.join(', ')}.\n` +
      `Discipline #21(a): assert only what traces to a source. Remove them or build them.`
    );
  }
  if (strict && missing.length) {
    throw new Error(
      `self-model cannot be derived: doctor.config.json is missing \`self.${missing.join('`, `self.')}\`.\n` +
      `These are editorial and cannot be read from code. Discipline #20 fails the build rather than guess.\n` +
      `\`not_authoritative_on\` matters most: without it, refuse-and-point (#21b) has nothing to consult.`
    );
  }
  // A Next.js app serves static files from public/ and nowhere else, so the directory
  // has to be created when it is absent rather than falling back to the repo root, where
  // the file would be written, committed, deployed, and never served.
  const isNext = existsSync(join(root, 'next.config.mjs')) || existsSync(join(root, 'next.config.js')) ||
    existsSync(join(root, 'next.config.ts')) || !!(readJson(join(root, 'package.json'))?.dependencies?.next);
  const outDir = (isNext || existsSync(join(root, 'public')))
    ? join(root, 'public', '.well-known')
    : join(root, '.well-known');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'mrbrix-self.json');
  writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
  return { path: out, model };
}
