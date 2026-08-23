/**
 * SIG-2 — every source synced SUCCESSFULLY within its interval.
 *
 * Exists because: fourteen connectors were flagged error on 2026-07-27 and never ran again.
 * The selector was `where status = 'active'` and nothing wrote that column back, so the flag
 * was a one-way door. T1 showed a trailing-30-day window built from seven days of data,
 * under a teal "live" dot, for twenty-five days.
 *
 * The word that matters is SUCCESSFULLY. An attempt is not a sync. This check reads the last
 * successful contact, never the last attempt, because those two diverging is the exact
 * condition being detected.
 */
import { pass, fail, requireSample } from '../contract.mjs';
import { toBool as TO_BOOL } from '../run.mjs';

const ID = 'SIG-2';
const TITLE = 'Every data source synced successfully within its interval';
const SCOPE = 't1 <- vendor connectors';

/**
 * data = { sources: [{name, type, status, lastSuccessAgeSeconds|null}], intervalHours }
 * Ages are computed by Postgres. See sig1-emission.mjs for why JS date parsing is banned
 * on these columns.
 */
export function evaluate(data) {
  const empty = requireSample(data?.sources?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'sources' });
  if (empty) return empty;

  const { sources, intervalHours = 6 } = data;
  const graceSeconds = intervalHours * 2 * 3600; // two intervals before calling it dead
  // Case-insensitive: `status` is a free-text column with no enum behind it.
  const OFF = ['disabled', 'paused', 'archived', 'inactive', 'deleted'];
  const live = sources.filter(s => !OFF.includes(String(s.status ?? '').toLowerCase()));

  const emptyLive = requireSample(live.length, { id: ID, title: TITLE, scope: SCOPE, what: 'enabled sources' });
  if (emptyLive) return emptyLive;

  const stale = live.filter(s => {
    const age = s.lastSuccessAgeSeconds;
    // Never succeeded, or an age we cannot read, is STALE. The safe answer for an unknown
    // clock is the alarming one.
    if (age === null || age === undefined || !Number.isFinite(Number(age))) return true;
    return Number(age) > graceSeconds;
  });

  if (stale.length === 0) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `${live.length}/${live.length} enabled sources succeeded within ${intervalHours * 2}h` });
  }

  const byType = {};
  for (const s of stale) byType[s.type] = (byType[s.type] || 0) + 1;
  const summary = Object.entries(byType).map(([t, n]) => `${t}×${n}`).join(', ');
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: `${stale.length}/${live.length} enabled sources have not succeeded in ${intervalHours * 2}h: ${summary}`,
    fix: 'Read the per-source error. If every failure shares one message, it is one cause, not many. Check SEAM-1 first.',
  });
}

export async function measure(ctx) {
  const rows = await ctx.query(
    'select name, type, status, extract(epoch from (now() - "lastSyncAt"))::float8 as age_seconds, ' +
    '("lastError" is not null) as has_error from connectors'
  );
  return {
    intervalHours: ctx.syncIntervalHours ?? 6,
    sources: rows.map(r => ({
      name: r.name,
      type: r.type,
      status: r.status,
      // A timestamp only counts as a success when the row is not carrying an error.
      // Trusting the clock alone is what let a dead feed look fresh.
      lastSuccessAgeSeconds: TO_BOOL(r.has_error) ? null : r.age_seconds,
    })),
  };
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 't1', measure, evaluate };
