/**
 * SIG-3 — every store that is written is read by something.
 *
 * Exists because: one table holds 11,946 rows written by exactly one insert and referenced
 * nowhere else in the codebase except a comment. Zero readers. The doctrine says a status
 * nothing writes is a grave; a store nothing reads is the same grave facing the other way,
 * and it is harder to notice because the writes look like progress.
 */
import { pass, fail, requireSample } from '../contract.mjs';

const ID = 'SIG-3';
const TITLE = 'Every store that is written is read by something';
const SCOPE = 'code · writes vs reads';

/** data = { stores: [{table, writes: n, reads: n, rows: n|null}] } */
export function evaluate(data) {
  const empty = requireSample(data?.stores?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'stores' });
  if (empty) return empty;

  const writeOnly = data.stores.filter((s) => s.writes > 0 && s.reads === 0);
  if (!writeOnly.length) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `${data.stores.length} store(s) written, each read by at least one query` });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: writeOnly.map((s) => `${s.table}: ${s.writes} write site(s), 0 reads${s.rows != null ? `, ${s.rows} rows` : ''}`).join('; '),
    fix: 'Either read it or stop writing it. A store accumulating rows nobody queries is cost and false confidence at the same time: it looks like the signal is being collected.',
  });
}

export async function measure(ctx) { return { stores: await ctx.scanStores() }; }
export default { id: ID, title: TITLE, scope: SCOPE, runner: 'ci', measure, evaluate };
