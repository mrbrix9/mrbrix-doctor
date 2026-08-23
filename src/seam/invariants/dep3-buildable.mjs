/**
 * DEP-3 — every linked directory is buildable.
 *
 * Exists because: three directories hold links to live projects while containing no
 * package.json. One of them is linked to the project serving a live customer site.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'DEP-3';
const TITLE = 'Every directory linked to a project can build one';
const SCOPE = 'this machine · deploy targets';

/** data = { links: [{dir, projectName, buildable:boolean}] } */
export function evaluate(data) {
  const empty = requireSample(data?.links?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'vercel links' });
  if (empty) return empty;

  const bad = data.links.filter((l) => l.buildable === false);
  if (bad.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: data.links.length + '/' + data.links.length + ' linked directories carry a manifest' });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: bad.length + '/' + data.links.length + ' linked directories have no package.json: ' + bad.map((b) => b.dir.split('/').slice(-2).join('/') + ' -> ' + (b.projectName || '?')).join(', '),
    fix: 'Remove the link, or move it to the directory that builds the project. A deploy from an unbuildable folder is the fastest way to take a live site down.',
  });
}

export async function measure(ctx) { return { links: await ctx.listLinks({ withBuildable: true }) }; }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'local', measure, evaluate };
