/**
 * The Seam Doctor — result contract.
 *
 * Extends @mrbrix/doctor's existing shape ({id, title, status, evidence}) with two
 * fields the portfolio scope needs:
 *
 *   scope  names a SEAM ("t1 <- nikkimike"), not a repository. The unit of failure
 *          here is the space between two things, so the unit of reporting must be too.
 *   fix    required on failure. A check that reports a problem without naming the
 *          remedy relocates the archaeology instead of ending it.
 *
 * Every invariant is split in two on purpose:
 *
 *   measure(ctx)   does the IO. Network, database, filesystem. Untestable offline.
 *   evaluate(data) is pure. Takes what measure returned, returns a verdict.
 *
 * The split is the whole reason this is testable. Logic that must hold for every
 * caller does not belong in the part callers are allowed to replace, so the verdict
 * never lives inside the fetch.
 */

export const PASS = 'pass';
export const FAIL = 'fail';
export const SKIP = 'skip';

/**
 * Build a result. `evidence` is mandatory in both directions: a pass with no evidence
 * is indistinguishable from a check that ran against nothing, which is the failure
 * mode this engine exists to remove.
 */
export function result({ id, title, status, evidence, scope, fix }) {
  if (!id) throw new Error('result: id is required');
  // An unrecognised status is counted in no bucket and affects no verdict, so it would
  // vanish from the roll-up entirely. Reject it at construction.
  if (![PASS, FAIL, SKIP].includes(status)) throw new Error(`result ${id}: unknown status "${status}"`);
  if (!evidence) throw new Error(`result ${id}: evidence is required — a verdict without it is a claim`);
  if (status === FAIL && !fix) throw new Error(`result ${id}: a failing check must name its fix`);
  return { id, title, status, evidence, scope, ...(fix ? { fix } : {}) };
}

export const pass = (o) => result({ ...o, status: PASS });
export const fail = (o) => result({ ...o, status: FAIL });
export const skip = (o) => result({ ...o, status: SKIP });

/**
 * Guard against the assertion that passes on nothing.
 *
 * A check handed an empty measurement must SKIP loudly, never PASS. "I looked at zero
 * things and found zero problems" is the single most common way a green suite means
 * nothing at all.
 */
export function requireSample(n, { id, title, scope, what }) {
  if (typeof n !== 'number' || Number.isNaN(n)) {
    return skip({ id, title, scope, evidence: `no measurement taken for ${what}` });
  }
  if (n === 0) {
    return skip({ id, title, scope, evidence: `sample was empty (0 ${what}) — cannot assert on nothing` });
  }
  return null;
}
