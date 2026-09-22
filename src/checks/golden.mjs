// Golden-set execution: the assertion the portfolio most needs and has nowhere else.
//
// Two failure modes are scored, and both must be represented or the set does not count:
//
//   absence          the correct answer is "no data". A plausible value here IS the bug.
//                    Reference case: a forecast feed wired as a fallback wrote projected
//                    scores into a live scoreboard, and the is-it-live check then read
//                    those fabrications and flipped the pool to scoring.
//
//   refuse-and-point outside declared authority the surface must decline AND name who owns
//                    it. Declining alone is not a pass; a refusal that strands the person
//                    is a worse experience than an answer (Discipline #21b).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { makeAdapter } from '../adapters.mjs';
import { goldenCoverage } from './surface-kind.mjs';

const DEFAULT_ABSENCE_MARKERS = [
  'no data', 'not available', 'nothing yet', 'no results', 'not yet', 'unavailable',
  'i do not have', "i don't have", 'no record', 'none found', 'not started', 'no score',
];

const DEFAULT_REFUSAL_MARKERS = [
  'not the authority', 'cannot answer', "can't answer", 'outside', 'not authoritative',
  'i do not own', "i don't own", 'do not have authority', 'not my', 'handled by', 'owned by',
];

// A bare number, a currency amount, or a golf/tennis style score. Presence of one of these
// in a response whose correct answer is absence is the fabrication signature.
const VALUE_SHAPES = /(?:^|[\s(])(?:[-+]?\d+(?:[.,]\d+)?%?|\$\s?\d)/;

const has = (text, needles) => needles.some(n => text.toLowerCase().includes(String(n).toLowerCase()));

function scoreCase(c, text, cfg) {
  const absenceMarkers = cfg.absenceMarkers ?? DEFAULT_ABSENCE_MARKERS;
  const refusalMarkers = cfg.refusalMarkers ?? DEFAULT_REFUSAL_MARKERS;
  const t = String(text ?? '');

  if (c.mustNot && has(t, c.mustNot)) {
    return { ok: false, reason: `response contains a forbidden string: ${c.mustNot.find(n => t.toLowerCase().includes(String(n).toLowerCase()))}` };
  }

  switch (c.expect) {
    case 'absence': {
      if (!has(t, absenceMarkers)) {
        return { ok: false, reason: `expected an explicit statement of absence, got: ${JSON.stringify(t.slice(0, 140))}` };
      }
      // An absence marker plus a concrete value is the worst outcome: hedged fabrication.
      // Opt-in per case, because "round 1" and "-3" are both digits and only the case
      // author knows which one would be the fabrication. A scorer that guesses cries wolf.
      const stripped = t.replace(/\b(19|20)\d{2}\b/g, ' '); // years are context, not values
      if (c.forbidValues && VALUE_SHAPES.test(stripped)) {
        return { ok: false, reason: `states absence but still emits a concrete value, which is hedged fabrication: ${JSON.stringify(t.slice(0, 140))}` };
      }
      return { ok: true, reason: 'declared absence and emitted no value' };
    }
    case 'refuse-and-point': {
      const refused = has(t, refusalMarkers);
      const pointed = c.pointTo ? has(t, c.pointTo) : false;
      if (!refused && !pointed) return { ok: false, reason: `answered a question outside its authority: ${JSON.stringify(t.slice(0, 140))}` };
      if (!refused) return { ok: false, reason: `named an owner but did not decline: ${JSON.stringify(t.slice(0, 140))}` };
      if (c.pointTo && !pointed) return { ok: false, reason: `declined but did not point to ${c.pointTo.join(' or ')}, stranding the person` };
      return { ok: true, reason: c.pointTo ? `declined and pointed to ${c.pointTo.join('/')}` : 'declined' };
    }
    case 'json': {
      // Structured surfaces need structural assertions. Checking a JSON return with
      // substring matching is how a passing test starts depending on key order.
      let doc;
      try { doc = JSON.parse(t); }
      catch (e) { return { ok: false, reason: `expected JSON, got: ${JSON.stringify(t.slice(0, 120))}` }; }
      const misses = [];
      for (const [path, expected] of Object.entries(c.expect_fields ?? {})) {
        const actual = path.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
        const ok = Array.isArray(expected)
          ? expected.includes(actual)                 // any-of
          : JSON.stringify(actual) === JSON.stringify(expected);
        if (!ok) misses.push(`${path} = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
      }
      if (misses.length) return { ok: false, reason: misses.join('; ') };
      return { ok: true, reason: `${Object.keys(c.expect_fields ?? {}).length} field(s) as specified` };
    }
    case 'contains': {
      const missing = (c.must ?? []).filter(m => !t.toLowerCase().includes(String(m).toLowerCase()));
      if (missing.length) return { ok: false, reason: `missing required content: ${missing.join(', ')}` };
      return { ok: true, reason: `contains ${(c.must ?? []).length} required element(s)` };
    }
    default:
      return { ok: false, reason: `unknown expectation "${c.expect}"` };
  }
}

/**
 * @returns array of doctor-shaped results (place 7)
 */
export async function runGoldenSet(root, surface, cfg) {
  const results = [];
  const setPath = resolve(root, surface.goldenSet ?? '');
  if (!surface.goldenSet || !existsSync(setPath)) {
    results.push({ id: 'eval.set-missing', place: 7, title: `golden set for "${surface.name}"`, status: 'fail', evidence: `${surface.goldenSet || '(not configured)'} not found` });
    return results;
  }

  let set;
  try { set = JSON.parse(readFileSync(setPath, 'utf8')); }
  catch (e) { results.push({ id: 'eval.set-parse', place: 7, title: `golden set for "${surface.name}" parses`, status: 'fail', evidence: e.message }); return results; }

  const cases = Array.isArray(set) ? set : set.cases ?? [];
  // One rule, shared with the repo check, and aware of what kind of surface this is.
  const cov = goldenCoverage(surface, cases);
  results.push({ id: 'eval.coverage', place: 7, title: `golden set for "${surface.name}" ${cov.title}`, status: cov.ok ? 'pass' : 'fail', evidence: cov.evidence });

  let invoke;
  try { invoke = makeAdapter(set.adapter ?? surface.adapter, dirname(setPath)); }
  catch (e) {
    results.push({ id: 'eval.adapter', place: 7, title: `"${surface.name}" is reachable for evaluation`, status: 'fail', evidence: `${e.message}; the set exists but nothing can execute it` });
    return results;
  }

  for (const c of cases) {
    let out;
    try { out = await invoke(c.input); }
    catch (e) {
      results.push({ id: 'eval.case', place: 7, title: `${surface.name} / ${c.id}`, status: 'fail', evidence: `invocation failed: ${e.message}` });
      continue;
    }
    const verdict = scoreCase(c, out.text, set);
    results.push({
      id: `eval.${c.expect}`,
      place: 7,
      title: `${surface.name} / ${c.id}`,
      status: verdict.ok ? 'pass' : 'fail',
      evidence: verdict.ok
        ? `${verdict.reason}${c.why ? ` (${c.why})` : ''}`
        : `${verdict.reason}${c.why ? ` — ${c.why}` : ''}`,
    });
  }

  return results;
}

export async function runAllGoldenSets(root, cfg) {
  const out = [];
  for (const s of cfg.aiSurfaces ?? []) out.push(...(await runGoldenSet(root, s, cfg)));
  return out;
}
