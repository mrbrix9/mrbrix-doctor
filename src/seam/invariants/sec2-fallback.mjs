/**
 * SEC-2 — a shared secret has one owner, never a per-service fallback.
 *
 * Exists because: two services agree on an encryption key by both deriving it from
 * `CONNECTOR_ENC_KEY || JWT_SECRET`. That fallback resolves to each service's OWN local
 * secret, so the two agree right up until one of them changes, and then disagree with no
 * signal at all. The failure surfaces as an opaque vendor-auth error and sends whoever
 * reads it looking in the wrong place. It sent me looking in the wrong place.
 *
 * The pattern is the finding: `env.SHARED || env.LOCAL` inside anything that derives a key.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SEC-2';
const TITLE = 'No shared secret falls back to a service-local one';
const SCOPE = 'cross-service secrets';

/** data = { sites: [{file, line, expression}], filesScanned } */
export function evaluate(data) {
  const empty = requireSample(data?.filesScanned, { id: ID, title: TITLE, scope: SCOPE, what: 'source files' });
  if (empty) return empty;

  const sites = data.sites ?? [];
  if (!sites.length) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `no shared-secret fallback in ${data.filesScanned} scanned files` });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: `${sites.length} secret(s) fall back to a service-local variable: ` + sites.slice(0, 4).map((s) => `${s.file}:${s.line}`).join(', ') + (sites.length > 4 ? ` +${sites.length - 4}` : ''),
    fix: 'Give the shared secret one name and require it. A fallback to a local variable makes two services agree by coincidence, and the day they stop agreeing the error names the wrong culprit.',
  });
}

export async function measure(ctx) { return ctx.scanSecretFallbacks(); }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'ci', measure, evaluate };
