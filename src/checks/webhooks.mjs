// Registered webhook endpoints must be directly reachable — no redirects, no bare origins.
//
// THE REFERENCE CASE (2026-09-04, and it cost four months of silence):
//
//   Stripe, like most webhook senders, DOES NOT FOLLOW REDIRECTS. An endpoint registered
//   on a host that 3xx's is a FAILED DELIVERY, every single time, forever. Nothing in our
//   systems logs it, because nothing in our systems is ever reached. The sender's own
//   dashboard is the only place the failure is visible, and nobody looks there until
//   something downstream is obviously wrong.
//
//   Two of six registered endpoints were broken this way, in OPPOSITE directions:
//
//     textayo      registered on the apex; the site canonicalises to www  -> 308
//     fullthrottle registered on www; the site canonicalises to the apex  -> 308
//
//   fullthrottle's was worse: the registered URL was the bare site root with NO PATH, so
//   even on the correct host it addressed the homepage rather than a handler. It had never
//   worked since the day it was created, and it carried checkout.session.completed against
//   a LIVE Stripe key and the production database. The first real payment would have been
//   charged to a customer and left no record on our side.
//
// Neither was a code bug. Both were one wrong string in a dashboard, and both were
// detectable with a single HTTP request at any point in the preceding four months.
//
// This check is that request.
//
// WHAT IT DELIBERATELY DOES NOT DO: assert that a 200 came back. A webhook handler that
// answers GET with 200 is usually a sign it is not a handler at all. We assert the two
// things that are unambiguous — the host does not redirect, and the URL addresses a path.

const UA = 'mrbrix-doctor/0.1 (+webhook-reachability)';

async function probe(url, { timeout = 15000, method = 'GET' } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual', // the entire point: see the 3xx the sender would see
      signal: ac.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
    });
    return { ok: true, status: res.status, location: res.headers.get('location') };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e.name === 'AbortError' ? `timeout after ${timeout}ms` : e.message,
    };
  } finally {
    clearTimeout(t);
  }
}

const pass = (id, place, title, evidence) => ({ id, place, title, status: 'pass', evidence });
const fail = (id, place, title, evidence) => ({ id, place, title, status: 'fail', evidence });
const skip = (id, place, title, evidence) => ({ id, place, title, status: 'skip', evidence });

/** Accept either "https://..." or { name, url } so the config can stay terse or be labelled. */
function normalise(entry) {
  if (typeof entry === 'string') return { name: entry, url: entry };
  return { name: entry?.name ?? entry?.url ?? '(unnamed)', url: entry?.url };
}

export async function runWebhookChecks(cfg) {
  const entries = (cfg.webhookEndpoints ?? []).map(normalise);
  if (entries.length === 0) {
    return [
      skip(
        'webhook.registered',
        1,
        'registered webhook endpoints',
        'no webhookEndpoints configured — list every URL registered with a sender (Stripe, Twilio, GitHub) or this check cannot see them',
      ),
    ];
  }

  const results = [];

  for (const { name, url } of entries) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      results.push(fail('webhook.url', 1, `${name} is a valid URL`, `cannot parse ${JSON.stringify(url)}`));
      continue;
    }

    // A bare origin is never a handler. This is the fullthrottle failure exactly.
    if (parsed.pathname === '' || parsed.pathname === '/') {
      results.push(
        fail(
          'webhook.path',
          1,
          `${name} addresses a path`,
          `${url} has no path — it points at the site root, not a handler. A sender POSTing here hits the homepage.`,
        ),
      );
      continue;
    }

    const r = await probe(url);

    if (!r.ok) {
      results.push(fail('webhook.reachable', 1, `${name} reachable`, r.error));
      continue;
    }

    if (r.status >= 300 && r.status < 400) {
      results.push(
        fail(
          'webhook.no-redirect',
          1,
          `${name} does not redirect`,
          `HTTP ${r.status} -> ${r.location ?? '(no Location header)'} — senders do not follow redirects, so EVERY delivery to this URL fails silently. Register ${r.location ?? 'the final URL'} instead.`,
        ),
      );
      continue;
    }

    results.push(
      pass(
        'webhook.no-redirect',
        1,
        `${name} is directly reachable`,
        `HTTP ${r.status}, no redirect`,
      ),
    );
  }

  return results;
}
