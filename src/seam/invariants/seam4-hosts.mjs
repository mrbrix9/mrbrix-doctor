/**
 * SEAM-4 — every hard-coded service host answers.
 *
 * Exists because: live code defaults to a host that returns 404, and the same repository
 * defaults to a DIFFERENT dead host for the same service in its scripts. A default URL
 * baked into source is a promise the code makes at runtime; nothing checked whether it
 * could be kept.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SEAM-4';
const TITLE = 'Every service host baked into source answers';
const SCOPE = 'code -> services';

/** data = { hosts: [{url, status, sources: []}] } */
export function evaluate(data) {
  const empty = requireSample(data?.hosts?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'hard-coded hosts' });
  if (empty) return empty;

  const dead = data.hosts.filter((h) => !h.status || h.status >= 400);
  if (!dead.length) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `${data.hosts.length}/${data.hosts.length} hard-coded service hosts answer` });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: `${dead.length}/${data.hosts.length} dead: ` + dead.map((d) => `${d.url} (${d.status || 'no response'}) referenced by ${d.sources.slice(0, 2).join(', ')}`).join('; '),
    fix: 'Point the default at a host that resolves, or remove the default so a missing environment variable fails loudly instead of dialling a dead address at runtime.',
  });
}

export async function measure(ctx) { return { hosts: await ctx.probeCodeHosts() }; }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'ci', measure, evaluate };
