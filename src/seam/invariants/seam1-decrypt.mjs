/**
 * SEAM-1 — the reader can decrypt what the writer encrypted.
 *
 * Exists because: on 2026-08-22, fourteen of twenty-one data sources were failing with
 * "Unsupported state or unable to authenticate data". That reads like a vendor rejecting
 * a credential. It is Node's error when aes-256-gcm decryption fails on a key mismatch.
 * The credentials were valid the whole time; the reader could not open them. The portfolio
 * reported $0 revenue under a green dot for twenty-five days on the first occurrence.
 *
 * The seam: nikkimike encrypts connector credentials, T1 decrypts them. Both derive the
 * key as sha256(CONNECTOR_ENC_KEY || JWT_SECRET) — and that fallback to a SERVICE-LOCAL
 * variable is the defect. A shared secret that silently resolves to a private one agrees
 * until one side changes, then disagrees with no signal.
 */
import { createDecipheriv, createHash } from 'node:crypto';
import { pass, fail, skip, requireSample } from '../contract.mjs';

const ID = 'SEAM-1';
const TITLE = 'T1 can decrypt connector credentials written by NikkiMike';
const SCOPE = 't1 <- nikkimike';

/** Attempt one blob. Returns true/false only — never the plaintext, never the secret. */
export function tryDecrypt(blob, secret) {
  try {
    const parts = String(blob).split('.');
    if (parts.length !== 3) return false;
    const [ivB, tagB, ctB] = parts;
    const key = createHash('sha256').update(secret).digest();
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    const pt = Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]);
    JSON.parse(pt.toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure verdict.
 * data = { total, decrypted, failedNames, keySource, allConnectors }
 *
 * `keySource` names WHICH secret was tried. Absent means no key was configured at all,
 * which is a SKIP rather than a fail: reporting "the key does not match" when no key was
 * read is a confidently wrong diagnosis, in the check that exists to prevent one.
 */
export function evaluate(data) {
  if (!data?.keySource) {
    return skip({ id: ID, title: TITLE, scope: SCOPE, evidence: 'no CONNECTOR_ENC_KEY or JWT_SECRET available to test with; nothing was verified' });
  }
  const empty = requireSample(data?.total, { id: ID, title: TITLE, scope: SCOPE, what: 'encrypted credentials' });
  if (empty) return empty;

  const { total, decrypted, failedNames = [], keySource, allConnectors } = data;
  // Disclose the denominator. `total` counts only rows using the known envelope; if the
  // writer renames that key, total silently shrinks and a partial check looks complete.
  const coverage = allConnectors && allConnectors !== total ? ` (of ${allConnectors} connectors, ${total} use this envelope)` : '';
  if (decrypted === total) {
    return pass({ id: ID, title: TITLE, scope: SCOPE, evidence: `${decrypted}/${total} credentials decrypt using ${keySource}${coverage}` });
  }
  const shown = failedNames.slice(0, 4).join(', ');
  const more = failedNames.length > 4 ? ` +${failedNames.length - 4} more` : '';
  return fail({
    id: ID, title: TITLE, scope: SCOPE,
    evidence: `${total - decrypted}/${total} credentials will not decrypt using ${keySource}: ${shown}${more}`,
    fix: "The key being tested does not match the secret these were encrypted with. Do NOT rotate the credentials; they are valid. Check whether direct-database connectors failed too: if they did not, the key is not the cause.",
  });
}

/**
 * IO. Tries CONNECTOR_ENC_KEY, then the JWT_SECRET fallback that both services actually
 * use, and reports which one worked.
 *
 * SCOPE LIMIT, stated rather than implied: this reads the key available to THIS machine.
 * A pass means a correct key exists locally, not that the deployed runtime holds it. The
 * outage that motivated this invariant lived in the deployed environment, which nothing
 * here can reach.
 */
export async function measure(ctx) {
  const rows = await ctx.query("select name, credentials->>'enc' as enc from connectors where credentials ? 'enc'");
  const all = await ctx.query('select count(*)::int as n from connectors');
  const allConnectors = all?.[0]?.n ?? null;

  const candidates = [
    ['CONNECTOR_ENC_KEY (local)', ctx.secrets?.connectorEncKey],
    ['JWT_SECRET fallback (local)', ctx.secrets?.jwtSecret],
  ].filter(([, v]) => !!v);

  if (!candidates.length || !rows.length) {
    return { total: rows.length, decrypted: 0, failedNames: [], keySource: candidates[0]?.[0] ?? null, allConnectors };
  }

  let best = null;
  for (const [label, secret] of candidates) {
    let decrypted = 0;
    const failedNames = [];
    for (const r of rows) {
      if (tryDecrypt(r.enc, secret)) decrypted++;
      else failedNames.push(r.name);
    }
    const attempt = { total: rows.length, decrypted, failedNames, keySource: label, allConnectors };
    if (!best || attempt.decrypted > best.decrypted) best = attempt;
    if (decrypted === rows.length) break;
  }
  return best;
}

export default { id: ID, title: TITLE, scope: SCOPE, runner: 't1', measure, evaluate };
