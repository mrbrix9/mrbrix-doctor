/**
 * SEAM-3 — every vendored SDK matches the canonical build.
 *
 * Exists because: none of the six @mrbrix packages is published; every consumer installs a
 * `file:` tarball. Two different tarballs both call themselves identity-sdk 0.1.0 and
 * differ in bytes, while the canonical source is already at 0.1.1. Three versions of "the"
 * SDK are in production and the version string cannot distinguish two of them.
 *
 * A copy has no version. This check gives it one by content.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SEAM-3';
const TITLE = 'Every vendored SDK copy is the same build';
const SCOPE = 'packages · canonical vs copies';

/** data = { packages: [{name, copies: [{path, sha}]}] } */
export function evaluate(data) {
  const empty = requireSample(data?.packages?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'vendored packages' });
  if (empty) return empty;

  const forked = data.packages.filter((p) => new Set(p.copies.map((c) => c.sha)).size > 1);
  const total = data.packages.reduce((n, p) => n + p.copies.length, 0);

  if (!forked.length) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `${total} vendored copies across ${data.packages.length} package(s), each package internally identical` });
  }
  const detail = forked.map((p) => `${p.name}: ${new Set(p.copies.map((c) => c.sha)).size} distinct builds across ${p.copies.length} copies`).join('; ');
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: detail,
    fix: 'Publish the package, even to a private registry, so "shared" means "versioned". Until then every consumer is a fork and no fix propagates to any of them.',
  });
}

export async function measure(ctx) {
  const files = await ctx.findVendoredTarballs();
  const byName = new Map();
  for (const f of files) {
    const name = f.path.split('/').pop().replace(/-\d+\.\d+\.\d+\.tgz$/, '');
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
  }
  return { packages: [...byName.entries()].map(([name, copies]) => ({ name, copies })) };
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 'ci', measure, evaluate };
