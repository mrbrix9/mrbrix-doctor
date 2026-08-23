/**
 * SEAM-2 — every schema rider matches its owner.
 *
 * Exists because: one app carries a hand-copy of another's Prisma schema and points at the
 * same production database. The copy is 45 models behind, and four CRM models have lost
 * their `siteId` column entirely — multi-tenant tables read by a client that no longer
 * knows the tenant key exists. The rider's own CI passes, because its schema is internally
 * valid. Only a comparison across the two can see it.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SEAM-2';
const TITLE = 'Every schema rider matches the schema owner';
const SCOPE = 'shared database · owner vs riders';

/** data = { pairs: [{owner, rider, ownerModels:[], riderModels:[], fieldDrift:[{model, missing:[]}]}] } */
export function evaluate(data) {
  const empty = requireSample(data?.pairs?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'owner/rider pairs' });
  if (empty) return empty;

  const problems = [];
  for (const p of data.pairs) {
    const missing = p.ownerModels.filter((m) => !p.riderModels.includes(m));
    const drifted = (p.fieldDrift ?? []).filter((d) => d.missing.length);
    if (!missing.length && !drifted.length) continue;
    const bits = [];
    if (missing.length) bits.push(`${missing.length} models behind`);
    if (drifted.length) bits.push(`${drifted.length} model(s) missing fields (${drifted.slice(0, 3).map((d) => d.model + '.' + d.missing.join('/')).join(', ')})`);
    problems.push(`${p.rider} vs ${p.owner}: ${bits.join('; ')}`);
  }

  if (!problems.length) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `${data.pairs.length} rider(s) match their owner` });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: problems.join(' | '),
    fix: 'A schema has one owner. The rider should consume the owner’s generated client or a published package, not keep a copy. A field the rider has dropped is a column its queries silently ignore.',
  });
}

/** Models declared in a Prisma schema, in order. */
export function modelsIn(text) {
  return [...String(text).matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

/** Field names of one model. Used to find a dropped tenant key, not to diff formatting. */
export function fieldsOf(text, model) {
  const re = new RegExp('^model\\s+' + model + '\\s*\\{([\\s\\S]*?)^\\}', 'm');
  const body = re.exec(String(text));
  if (!body) return [];
  return [...body[1].matchAll(/^\s{2}(\w+)\s+\S/gm)].map((m) => m[1]);
}

export async function measure(ctx) {
  const pairs = [];
  for (const cfg of ctx.schemaPairs ?? []) {
    const ownerText = await ctx.readFile(cfg.owner);
    const riderText = await ctx.readFile(cfg.rider);
    if (ownerText == null || riderText == null) continue;
    const ownerModels = modelsIn(ownerText);
    const riderModels = modelsIn(riderText);
    const shared = ownerModels.filter((m) => riderModels.includes(m));
    const fieldDrift = [];
    for (const m of shared) {
      const of_ = fieldsOf(ownerText, m);
      const rf = fieldsOf(riderText, m);
      const missing = of_.filter((f) => !rf.includes(f));
      if (missing.length) fieldDrift.push({ model: m, missing });
    }
    pairs.push({ owner: cfg.ownerName ?? cfg.owner, rider: cfg.riderName ?? cfg.rider, ownerModels, riderModels, fieldDrift });
  }
  return { pairs };
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 'ci', measure, evaluate };
