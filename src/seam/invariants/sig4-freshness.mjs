/**
 * SIG-4 — a freshness clock never moves on a failure.
 *
 * Exists because a green dot over a stopped feed is how fourteen connectors went unnoticed
 * for twenty-five days. If a failed attempt bumps the timestamp that freshness is derived
 * from, a dead source looks current forever.
 *
 * ⚠️ REWRITTEN 2026-08-23 after this check produced a FALSE POSITIVE against a real
 * outage. The first version asked "does an errored row have a timestamp from the last
 * 24 hours?" — which is true of any source that succeeded this morning and has been
 * failing since lunch. That is normal and healthy: the clock is correctly frozen at the
 * last real success.
 *
 * The actual invariant is an ORDERING, not an age: the last-success timestamp must never
 * be NEWER than the moment the failure was recorded. Only that ordering proves the clock
 * moved on a failed attempt. A monitoring check that cries wolf is worse than no check,
 * because it teaches everyone to skip the row.
 *
 * SECOND FALSE POSITIVE, same day: a DISABLED connector carrying an explanatory note
 * ("Parked: not an active project") is not a failing source, and its metadata was written
 * by hand months apart, so the ordering is meaningless there. Deliberately-off sources are
 * excluded, exactly as SIG-2 excludes them.
 *
 * Known limit, stated rather than implied: `updatedAt` is a PROXY for when the failure was
 * recorded. A raw SQL update that bypasses the ORM will not bump it. The check is therefore
 * sound for sources written by the application and blind to ones edited by hand.
 */
import { pass, fail, requireSample } from '../contract.mjs';
import { toBool as TO_BOOL } from '../run.mjs';

const ID = 'SIG-4';
const TITLE = 'Freshness timestamps never move on a failed attempt';
const SCOPE = 't1 · self-instrumentation';

/** data = { rows: [{name, hasError, syncNewerThanError}] } */
export function evaluate(data) {
  const empty = requireSample(data?.rows?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'source rows' });
  if (empty) return empty;

  const { rows } = data;
  // Same exclusion list as SIG-2: a source switched off on purpose is not a failing one.
  const OFF = ['disabled', 'paused', 'archived', 'inactive', 'deleted'];
  const live = rows.filter((r) => !OFF.includes(String(r.status ?? '').toLowerCase()));

  const emptyLive = requireSample(live.length, { id: ID, title: TITLE, scope: SCOPE, what: 'enabled sources' });
  if (emptyLive) return emptyLive;

  const errored = live.filter((r) => r.hasError);

  // Nothing is currently failing, so the ordering cannot be observed either way. Saying
  // "pass" here would overclaim; the invariant is simply untested right now.
  if (!errored.length) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `no enabled source is currently in error (${live.length} checked); nothing could have moved a clock on a failure` });
  }

  const lying = errored.filter((r) => r.syncNewerThanError === true);
  if (!lying.length) {
    return pass({
      id: ID, title: TITLE, scope: SCOPE,
      evidence: `${errored.length} source(s) failing, and every one has its success clock frozen before the failure`,
    });
  }
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: `${lying.length}/${errored.length} failing sources have a success timestamp NEWER than their failure: ${lying.slice(0, 3).map((r) => r.name).join(', ')}${lying.length > 3 ? '…' : ''}`,
    fix: 'Move the lastSyncAt write inside the success branch of the sync runner. A failed attempt must not touch the freshness clock, or a dead feed reads as current.',
  });
}

export async function measure(ctx) {
  const rows = await ctx.query(
    'select name, status, ("lastError" is not null) as has_error, ' +
    '("lastSyncAt" is not null and "updatedAt" is not null and "lastSyncAt" > "updatedAt") as sync_after_error ' +
    'from connectors'
  );
  return {
    rows: rows.map((r) => ({
      name: r.name,
      status: r.status,
      hasError: TO_BOOL(r.has_error),
      syncNewerThanError: TO_BOOL(r.sync_after_error),
    })),
  };
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 't1', measure, evaluate };
