/**
 * DEP-2 — no two directories claim the same project.
 *
 * Exists because: a shell directory with no package.json holds the same project id as the
 * real textayo repo, the project serving a live customer site. A library package directory
 * holds the fullthrottle web project's id. These repos deploy the WORKING TREE, so a deploy
 * from the wrong folder does not fail. It succeeds at shipping the wrong thing.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'DEP-2';
const TITLE = 'No project is claimed by more than one directory';
const SCOPE = 'this machine · deploy targets';

export function evaluate(data) {
  const empty = requireSample(data?.links?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'vercel links' });
  if (empty) return empty;

  const byId = new Map();
  for (const l of data.links) {
    if (!byId.has(l.projectId)) byId.set(l.projectId, []);
    byId.get(l.projectId).push(l);
  }
  const dupes = [...byId.entries()].filter(([, ls]) => new Set(ls.map((l) => l.dir)).size > 1);

  if (dupes.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: byId.size + ' projects each claimed by exactly one directory' });
  }
  const detail = dupes.map(([, ls]) => (ls[0].projectName || 'project') + '×' + new Set(ls.map((l) => l.dir)).size).join(', ');
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: dupes.length + ' projects claimed by 2+ directories: ' + detail,
    fix: 'Keep the link in the directory that actually builds the app; delete the others. A duplicate link is a second door to production that nobody is watching.',
  });
}

export async function measure(ctx) { return { links: await ctx.listLinks() }; }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'local', measure, evaluate };
