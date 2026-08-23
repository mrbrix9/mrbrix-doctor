/**
 * Heartbeat — the record that the engine ran at all.
 *
 * THE SEPARATION THAT MATTERS: the Seam Doctor WRITES this file and never reads it. A
 * different process reads it and judges. That is not fussiness — a doctor that stops
 * running looks identical to a portfolio with no problems, and a staleness check living
 * inside the doctor cannot fire when the doctor is the thing that died. Fourteen
 * connectors stayed dead for twenty-five days under a green dot for exactly this reason.
 *
 * The sink is pluggable and defaults to a local file. Emitting to T1 is opt-in, because
 * building an instrument is not the same as deciding to write to production with it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** One line per run, append-only, newest last. */
export function beatFrom(report) {
  return {
    at: report.ranAt,
    verdict: report.verdict,
    pass: report.counts.pass,
    fail: report.counts.fail,
    skip: report.counts.skip,
    failing: report.results.filter((r) => r.status === 'fail').map((r) => r.id),
  };
}

export function writeBeat(path, beat, { keep = 200 } = {}) {
  let existing = [];
  try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch { existing = []; }
  if (!Array.isArray(existing)) existing = [];
  const next = [...existing, beat].slice(-keep);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next.length;
}

export function readBeats(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

/**
 * The judgement, kept pure so the reader can be tested without a clock or a filesystem.
 *
 * Three states, and the ordering is deliberate:
 *   missing  nothing has ever run. Not "fine".
 *   stale    it ran once and stopped. THE dangerous one, because the last known result
 *            was probably green and a stopped clock keeps showing it.
 *   live     it ran within the expected window.
 */
export function assessFreshness(beats, { now = new Date(), intervalMinutes = 360, tolerance = 2 } = {}) {
  if (!Array.isArray(beats) || beats.length === 0) {
    return { state: 'missing', evidence: 'the seam doctor has never recorded a run' };
  }
  const last = beats[beats.length - 1];
  const at = new Date(last.at).getTime();
  if (!Number.isFinite(at)) {
    return { state: 'missing', evidence: 'the newest heartbeat has an unreadable timestamp' };
  }
  const ageMinutes = (now.getTime() - at) / 60000;
  const limit = intervalMinutes * tolerance;
  if (ageMinutes > limit) {
    return {
      state: 'stale',
      ageMinutes: Math.round(ageMinutes),
      evidence: `last run was ${Math.round(ageMinutes)}m ago, past the ${limit}m limit; its verdict was "${last.verdict}" and is no longer evidence of anything`,
      last,
    };
  }
  return {
    state: 'live',
    ageMinutes: Math.round(ageMinutes),
    evidence: `last run ${Math.round(ageMinutes)}m ago: ${last.pass} pass, ${last.fail} fail, ${last.skip} skip`,
    last,
  };
}

/** What the board should show, in priority order. Staleness outranks the verdict itself. */
export function boardLine(freshness) {
  if (freshness.state === 'missing') return { severity: 'critical', text: 'SEAM DOCTOR HAS NEVER RUN' };
  if (freshness.state === 'stale') return { severity: 'critical', text: `SEAM DOCTOR IS STALE (${freshness.ageMinutes}m)` };
  const v = freshness.last?.verdict;
  if (v === 'fail') return { severity: 'critical', text: `${freshness.last.fail} seam(s) failing: ${freshness.last.failing.join(', ')}` };
  if (v === 'incomplete') return { severity: 'warning', text: `seam doctor incomplete: ${freshness.last.skip} check(s) could not be measured` };
  return { severity: 'ok', text: `all seams healthy (${freshness.ageMinutes}m ago)` };
}
