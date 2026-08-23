/**
 * DEP-1 — every local Vercel link points at a project that still exists.
 *
 * Exists because: five links across four deleted projects (Cove, afterwards, mrbrix-memory,
 * zovu twice) sit on this machine. A Vercel command in one of those directories does not
 * simply fail; it can offer to CREATE a new project, which is the more dangerous outcome
 * because it succeeds.
 */
import { pass, fail, skip, requireSample } from '../contract.mjs';

const ID = 'DEP-1';
const TITLE = 'Every local Vercel link points at a project that exists';
const SCOPE = 'this machine -> vercel';

/**
 * data = { links, existingIds, listingComplete }
 *
 * `listingComplete` matters more than it looks. The project list paginates, and reading
 * one page made eight live projects look deleted — a confident accusation against real
 * deployments, produced by the check that exists to stop confident wrong accusations. A
 * partial list can only ever prove a link IS valid, never that it is not.
 */
export function evaluate(data) {
  const empty = requireSample(data?.links?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'vercel links' });
  if (empty) return empty;

  const existing = new Set(data.existingIds ?? []);
  const emptyProjects = requireSample(existing.size, { id: ID, title: TITLE, scope: SCOPE, what: 'known projects' });
  if (emptyProjects) return emptyProjects; // never call every link dead because the list failed to load

  if (data.listingComplete === false) {
    const resolved = data.links.filter((l) => existing.has(l.projectId)).length;
    return skip({
      id: ID, title: TITLE, scope: SCOPE,
      evidence: `project listing was truncated (${existing.size} known); ${resolved}/${data.links.length} links confirmed live, the rest unproven`,
    });
  }
  const dangling = data.links.filter((l) => !existing.has(l.projectId));
  if (dangling.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: data.links.length + '/' + data.links.length + ' links resolve to a live project' });
  }
  const names = [...new Set(dangling.map((d) => d.projectName || d.projectId))];
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: dangling.length + '/' + data.links.length + ' links point at deleted projects (' + names.join(', ') + ') from: ' + dangling.map((d) => d.dir.split('/').slice(-2).join('/')).join(', '),
    fix: 'Delete the .vercel directory in each. They hold only a README and an id file, are gitignored everywhere, and removing one cannot affect a deployed site. Move any real vercel.json config OUT of .vercel first.',
  });
}

export async function measure(ctx) {
  const listing = ctx.listProjects ? await ctx.listProjects() : { ids: await ctx.listProjectIds(), complete: true };
  return { links: await ctx.listLinks(), existingIds: listing.ids, listingComplete: listing.complete };
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 'local', measure, evaluate };
