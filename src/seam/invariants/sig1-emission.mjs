/**
 * SIG-1 — every active property has emitted to T1 recently.
 *
 * Exists because: the Build Doctrine says every property webhooks its meaningful events to
 * T1, and "if something meaningful happens and T1 does not know, that is a bug." On
 * 2026-08-22 the event store contained exactly ONE brand across 1,056 events and 11,946
 * pulses, against seventeen registered properties. Eight of the ten active ones had never
 * had a line of emission code written.
 *
 * Absence of code fails no test anywhere. That is precisely why this check has to exist at
 * the portfolio scope: no repository can notice a file that was never created in it.
 */
import { pass, fail, requireSample } from '../contract.mjs';
import { toBool as TO_BOOL } from '../run.mjs';

const ID = 'SIG-1';
const TITLE = 'Every active property has emitted to T1 recently';
const SCOPE = 't1 <- all properties';

/**
 * data = { properties: [{slug, active}], emitters: { slug -> ageSeconds|null }, windowDays }
 *
 * Ages arrive as SECONDS computed by Postgres, never as date strings parsed here. The
 * columns behind them are `timestamp without time zone`, and this machine's clock is not
 * the database's; parsing a naive timestamp in JS silently shifts it by the local offset
 * and moved a 15-hour-old sync inside a 12-hour window. Age is computed where both sides
 * of the subtraction share a clock.
 */
export function evaluate(data) {
  const empty = requireSample(data?.properties?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'registered properties' });
  if (empty) return empty;

  const { properties, emitters = {}, windowDays = 7 } = data;
  const active = properties.filter(p => p.active);

  const emptyActive = requireSample(active.length, { id: ID, title: TITLE, scope: SCOPE, what: 'active properties' });
  if (emptyActive) return emptyActive;

  const maxAge = windowDays * 86400;
  const silent = active.filter(p => {
    const age = emitters[p.slug];
    // Unknown age is SILENT, not fresh. Every comparison against NaN is false, so the
    // previous form made an unreadable clock read as healthy.
    if (age === null || age === undefined || !Number.isFinite(Number(age))) return true;
    return Number(age) > maxAge;
  });

  if (silent.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `${active.length}/${active.length} active properties emitted within ${windowDays}d` });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: `${silent.length}/${active.length} active properties silent for ${windowDays}d+: ${silent.slice(0, 5).map(p => p.slug).join(', ')}${silent.length > 5 ? ` +${silent.length - 5} more` : ''}`,
    fix: 'Each silent property needs an emitter and a per-brand ingest key. Adopt @mrbrix/sense rather than hand-rolling; three env var names for this key already exist across the portfolio.',
  });
}

export async function measure(ctx) {
  const sites = await ctx.query('select slug, "isActive" as is_active from sites');
  // Age in seconds, computed by the database. See the note on evaluate().
  const seen = await ctx.query(
    'select brand, extract(epoch from (now() - max(occurred_at)))::float8 as age_seconds from t1_event group by brand'
  );
  const emitters = {};
  for (const r of seen) emitters[r.brand] = r.age_seconds;
  return {
    windowDays: ctx.emissionWindowDays ?? 7,
    // toBool: psql/JSON can hand back 't'/'f'; `!!'f'` is true, which made every dormant
    // property read as active and demanded emission from parked sites.
    properties: sites.map(s => ({ slug: s.slug, active: TO_BOOL(s.is_active) })),
    emitters,
  };
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 't1', measure, evaluate };
