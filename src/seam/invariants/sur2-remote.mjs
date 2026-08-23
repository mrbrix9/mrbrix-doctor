/**
 * SUR-2 — every live product has a remote.
 *
 * Exists because: one deployed, answering site is not a git repository at all. The only
 * copy of its source is a folder on one Mac, and no backup convention covers it.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SUR-2';
const TITLE = 'Every deployed directory has a git remote';
const SCOPE = 'this machine · source of truth';

export function evaluate(data) {
  const empty = requireSample(data?.links?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'linked directories' });
  if (empty) return empty;

  const orphans = data.links.filter((l) => !l.remote);
  if (orphans.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: data.links.length + '/' + data.links.length + ' linked directories have a remote' });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: orphans.length + '/' + data.links.length + ' deployed directories exist only on this machine: ' + orphans.map((o) => o.dir.split('/').pop()).join(', '),
    fix: 'Create a private remote and push. A live site whose source exists in one place is one disk failure from being unrecoverable.',
  });
}

export async function measure(ctx) { return { links: await ctx.listLinks({ withRemote: true }) }; }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'local', measure, evaluate };
