/**
 * SIG-5 — no source failed in the recent run history.
 *
 * Exists because of a mistake made while building this engine, which is the best reason
 * an invariant can have.
 *
 * On 2026-08-22 at ~22:00 UTC, fourteen connectors were in error. Six hours later the
 * scheduled run recovered every one of them. SIG-2 reads the CURRENT state and correctly
 * reported a pass, which means SIG-2 would have said nothing at all about a portfolio-wide
 * six-hour outage. A check on present state cannot see a wound that has closed.
 *
 * Worse, the snapshot invited a wrong diagnosis: a single moment of state was read as a
 * standing root cause, and the theory survived until the next run disproved it. The run log
 * is the difference between a moment and a series.
 *
 * This check is therefore deliberately NOISIER than SIG-2. A failure that healed is still a
 * failure that happened, and the point is to notice it while the evidence is still there.
 *
 * ⚠️ COVERAGE ADDED 2026-08-23, because this check reported 40/40 runs successful while
 * fourteen connectors sat in error. Both statements were true: a SECOND sync runner exists
 * that writes no run log at all, so the log was complete about what it saw and blind to
 * half of what happened.
 *
 * Name-coverage alone was not enough, and finding that out mattered: the second runner
 * touches the SAME sources, so every name did appear in the log. The detectable
 * contradiction is not a missing name, it is a missing FAILURE.
 *
 * THE RECONCILIATION: if a source is sitting in an error state and the log contains no
 * failed run for it, then something failed it outside the log. That is the only signature
 * a hidden second writer leaves behind, and it is exactly what happened — two runners on
 * one schedule, one of which records nothing.
 */
import { pass, fail, requireSample } from '../contract.mjs';
import { toBool as TO_BOOL } from '../run.mjs';

const ID = 'SIG-5';
const TITLE = 'No source failed in the recent run history';
const SCOPE = 't1 · run log';

/**
 * data = { runs, windowHours, expectedSources: [names] | null }
 *
 * `expectedSources` is the set that SHOULD appear in the log. Null means coverage was not
 * measured, which is reported rather than assumed complete.
 */
export function evaluate(data) {
  const empty = requireSample(data?.runs?.length, { id: ID, title: TITLE, scope: SCOPE, what: 'recorded runs' });
  if (empty) return empty;

  const { runs, windowHours = 48 } = data;
  const maxAge = windowHours * 3600;
  const recent = runs.filter((r) => {
    const age = r.ageSeconds;
    if (age === null || age === undefined || !Number.isFinite(Number(age))) return false;
    return Number(age) <= maxAge;
  });

  const emptyRecent = requireSample(recent.length, { id: ID, title: TITLE, scope: SCOPE, what: 'runs in window' });
  if (emptyRecent) return emptyRecent;

  // Coverage first. A failure in the log outranks it, because a known failure is worse
  // than an unknown one, but a clean log can never clear a source it never mentions.
  const seen = new Set(recent.map((r) => r.name));
  const missing = (data.expectedSources ?? []).filter((n) => !seen.has(n));

  const failures = recent.filter((r) => !r.ok);

  // The reconciliation. A source in an error state with no logged failure was failed by
  // something that leaves no record. This outranks a clean log, because a clean log is
  // exactly what a hidden writer produces.
  const loggedFailures = new Set(failures.map((r) => r.name));
  const unexplained = (data.erroredSources ?? []).filter((n) => !loggedFailures.has(n));
  if (unexplained.length) {
    return fail({
      id: ID, title: TITLE, scope: SCOPE,
      evidence: unexplained.length + ' source(s) are in an error state with NO failed run in the log: ' +
        unexplained.slice(0, 4).join(', ') + (unexplained.length > 4 ? ` +${unexplained.length - 4}` : '') +
        '. Something failed them without recording it.',
      fix: 'A second writer is mutating these sources outside the logged runner. Find it and either retire it or make it write a run record. Check for two cron paths on the same schedule doing the same job.',
    });
  }
  if (failures.length === 0) {
    if (data.expectedSources == null) {
      return pass({
        id: ID, title: TITLE, scope: SCOPE,
        evidence: recent.length + '/' + recent.length + ' logged runs in the last ' + windowHours + 'h succeeded (coverage unverified)',
      });
    }
    if (missing.length) {
      return fail({
        id: ID, title: TITLE, scope: SCOPE,
        evidence: recent.length + ' logged runs all succeeded, but ' + missing.length + '/' + data.expectedSources.length +
          ' source(s) never appear in the log at all: ' + missing.slice(0, 4).join(', ') + (missing.length > 4 ? ` +${missing.length - 4}` : '') +
          '. A clean log cannot clear a source it does not mention.',
        fix: 'Something is running these sources without writing a run record. Find the second runner and either retire it or make it log. Until then this check is blind to whatever it does.',
      });
    }
    return pass({
      id: ID, title: TITLE, scope: SCOPE,
      evidence: recent.length + ' runs in the last ' + windowHours + 'h succeeded, covering all ' + data.expectedSources.length + ' source(s)',
    });
  }

  // Group by the error text. One shared message across many sources is one cause, and
  // saying so is the difference between fixing a thing and investigating fourteen things.
  const byError = {};
  for (const f of failures) {
    const k = (f.error || 'unknown').slice(0, 60);
    byError[k] = (byError[k] || 0) + 1;
  }
  const distinct = Object.keys(byError).length;
  const top = Object.entries(byError).sort((a, b) => b[1] - a[1])[0];

  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: failures.length + '/' + recent.length + ' runs failed in the last ' + windowHours + 'h across ' + distinct +
      ' distinct error' + (distinct === 1 ? '' : 's') + '; most common (' + top[1] + '): "' + top[0] + '"',
    fix: distinct === 1
      ? 'One message across every failure is ONE cause. Diagnose the shared path, not the individual sources. Check whether appdb sources failed alongside the vendor ones before suspecting the encryption key.'
      : 'Multiple distinct errors: treat these as separate faults and read the run log per source.',
  });
}

export async function measure(ctx) {
  const rows = await ctx.query(
    'select connector_name as name, connector_type as type, ok, ' +
    'extract(epoch from (now() - ran_at))::float8 as age_seconds, error from t1_sync_run'
  );
  // The sources that SHOULD be in the log: everything not deliberately switched off.
  const expected = await ctx.query(
    "select name from connectors where lower(coalesce(status,'')) not in ('disabled','paused','archived','inactive','deleted')"
  );
  const errored = await ctx.query(
    "select name from connectors where \"lastError\" is not null " +
    "and lower(coalesce(status,'')) not in ('disabled','paused','archived','inactive','deleted')"
  );
  return {
    expectedSources: expected.map((r) => r.name),
    erroredSources: errored.map((r) => r.name),
    windowHours: ctx.runWindowHours ?? 48,
    runs: rows.map((r) => ({
      name: r.name,
      type: r.type,
      ok: TO_BOOL(r.ok),
      ageSeconds: r.age_seconds,
      error: r.error,
    })),
  };
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 't1', measure, evaluate };
