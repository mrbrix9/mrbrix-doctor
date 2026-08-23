/**
 * SUR-1 — every branded domain serves its own product.
 *
 * Exists because: report.claims and adjust.claims both 302 to the portfolio homepage while
 * their applications are live and answering on vercel.app hostnames, and insure.claims has
 * no DNS at all — no A, no CNAME, no NS. Three working products with no reachable front
 * door, and nothing anywhere would have reported it, because no repository owns DNS.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SUR-1';
const TITLE = 'Every branded domain serves its own product';
const SCOPE = 'dns -> product';

/** data = { domains: [{domain, finalHost, status, resolved:boolean}] } */
export function evaluate(data) {
  const empty = requireSample(data?.domains?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'domains' });
  if (empty) return empty;

  const problems = [];
  for (const d of data.domains) {
    if (d.resolved === false || d.status === 0) { problems.push(d.domain + ' does not resolve'); continue; }
    if (d.status >= 400) { problems.push(d.domain + ' -> HTTP ' + d.status); continue; }
    // Landing on a different registrable name than the domain implies means the brand is dark.
    if (d.finalHost && !sameBrand(d.domain, d.finalHost)) problems.push(d.domain + ' -> ' + d.finalHost);
  }

  if (problems.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: data.domains.length + '/' + data.domains.length + ' domains serve their own product' });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: problems.length + '/' + data.domains.length + ' domains are dark: ' + problems.join('; '),
    fix: 'Attach each branded domain to its own Vercel project, or retire the domain. A product reachable only on a vercel.app hostname has no front door.',
  });
}

/** apex and www of the same registrable name are the same brand; anything else is not. */
export function sameBrand(domain, finalHost) {
  const strip = (h) => String(h).replace(/^www\./, '').toLowerCase();
  return strip(finalHost) === strip(domain);
}

export async function measure(ctx) { return { domains: await ctx.probeDomains() }; }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'local', measure, evaluate };
