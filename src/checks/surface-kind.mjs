// What kind of AI surface is this, and does its golden set cover the failures THAT kind can
// have? Not every surface is the same (Mike, 2026-09-22), so the Doctor asks each one what it
// is, then checks the answer is true, rather than special-casing any property.
//
//   answers  responds to people. It can fabricate a value AND answer outside its authority,
//            so its set must hold fabrication traps AND abstention (refuse-and-point) cases.
//            The default: a surface that says nothing is held to the full rule.
//
//   guard    answers nobody. It only accepts or rejects content another step produced (4GRAND's
//            ace-framing vets one generated line). It can still wave a fabrication through, so
//            traps are required, but there is no question for it to decline, and demanding an
//            abstention case of it can only be met by writing a fake one.
//
// A guard declaration is CHECKED, not trusted: it must say why the surface answers nobody,
// and every case must assert a structured verdict (`expect: "json"`), which the runner then
// holds it to at run time: a "guard" that returns prose fails every case. A kind the Doctor
// does not know fails, so a typo can never quietly loosen the rule.
//
// ONE function, called by both the repo check and the runner. They each counted coverage
// separately and drifted once already (fb9b177).

export const SURFACE_KINDS = ['answers', 'guard'];

export function goldenCoverage(surface, cases) {
  const kind = surface.kind ?? 'answers';
  const traps = cases.filter((c) => c.expect === 'absence' || c.trap === true).length;
  const abstentions = cases.filter((c) => c.expect === 'refuse-and-point').length;
  const counts = `${cases.length} cases, ${traps} fabrication traps, ${abstentions} abstention cases`;

  if (!SURFACE_KINDS.includes(kind)) {
    return { ok: false, title: 'declares a kind the Doctor knows', evidence: `unknown kind "${kind}"; declare one of: ${SURFACE_KINDS.join(', ')}` };
  }

  if (kind === 'guard') {
    const title = 'is a guard, and its set covers what a guard can get wrong';
    if (!String(surface.why ?? '').trim()) {
      return { ok: false, title, evidence: 'declared kind "guard" without a `why`: say why this surface never answers a person' };
    }
    const unstructured = cases.filter((c) => c.expect !== 'json').map((c) => c.id);
    if (unstructured.length) {
      return { ok: false, title, evidence: `a guard returns a structured verdict, but ${unstructured.join(', ')} ${unstructured.length === 1 ? 'is' : 'are'} not \`expect: "json"\`; if it answers people, it is kind "answers"` };
    }
    if (traps === 0) return { ok: false, title, evidence: `${counts}; a guard still needs fabrication traps` };
    return { ok: true, title, evidence: `${counts}; guard (${surface.why}), so no abstention case is owed` };
  }

  const title = 'covers both failure modes';
  if (traps === 0 || abstentions === 0) return { ok: false, title, evidence: `${counts}; both must be non-zero` };
  return { ok: true, title, evidence: counts };
}
