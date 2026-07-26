// Live-surface assertions. Every one of these parses CONTENTS, never presence.
// The MotoTerra failure is the reference case: every box was genuinely ticked and the
// site was still broken, because verification asked "does it exist" instead of "what is in it".

import { textOf, tagsInner, metaContent, linkHref, jsonLdBlocks, externalLinks } from '../html.mjs';

const UA_DEFAULT = 'mrbrix-doctor/0.1 (+proprioception; Playbook v1.15 §5.9)';

const CRAWLERS = [
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
  ['ClaudeBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com'],
  ['PerplexityBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot'],
  ['Applebot', 'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)'],
  ['meta-externalagent', 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
];

async function get(url, { ua = UA_DEFAULT, redirect = 'follow', timeout = 20000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      redirect,
      signal: ac.signal,
      headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,*/*' },
    });
    const body = res.headers.get('content-type')?.includes('image/') ? '' : await res.text();
    return { ok: true, status: res.status, url: res.url, location: res.headers.get('location'), body };
  } catch (e) {
    return { ok: false, status: 0, url, error: e.name === 'AbortError' ? `timeout after ${timeout}ms` : e.message, body: '' };
  } finally {
    clearTimeout(t);
  }
}

const pass = (id, place, title, evidence) => ({ id, place, title, status: 'pass', evidence });
const fail = (id, place, title, evidence) => ({ id, place, title, status: 'fail', evidence });
const skip = (id, place, title, evidence) => ({ id, place, title, status: 'skip', evidence });

/** Place 1 + hygiene: canonical host reachable, and redirects resolve in one hop. */
async function checkCanonicalHost(cfg, results) {
  const canonical = new URL(cfg.baseUrl);
  for (const variant of cfg.hostVariants ?? []) {
    const r = await get(variant, { redirect: 'manual' });
    if (!r.ok) { results.push(fail('redirect.one-hop', 1, `${variant} reachable`, r.error)); continue; }
    if (r.status >= 200 && r.status < 300 && new URL(r.url).host === canonical.host) {
      results.push(pass('redirect.one-hop', 1, `${variant} is canonical`, `${r.status} ${r.url}`));
      continue;
    }
    if (r.status < 300 || r.status >= 400 || !r.location) {
      results.push(fail('redirect.one-hop', 1, `${variant} redirects to canonical`, `expected 3xx to ${canonical.host}, got ${r.status}`));
      continue;
    }
    const dest = new URL(r.location, variant);
    const second = await get(dest.toString(), { redirect: 'manual' });
    if (dest.host === canonical.host && second.status < 300) {
      results.push(pass('redirect.one-hop', 1, `${variant} reaches canonical in one hop`, `${r.status} -> ${dest.toString()} (${second.status})`));
    } else {
      results.push(fail('redirect.one-hop', 1, `${variant} reaches canonical in one hop`, `${r.status} -> ${dest.toString()} then ${second.status}; chains are a ranking and crawler cost`));
    }
  }
}

/** The assertions that catch a page which returns 200 and is still broken. */
async function checkPageContents(cfg, results) {
  for (const path of cfg.pages ?? ['/']) {
    const url = new URL(path, cfg.baseUrl).toString();
    const r = await get(url);
    if (!r.ok || r.status !== 200) {
      results.push(fail('page.reachable', 1, `GET ${path}`, r.ok ? `HTTP ${r.status}` : r.error));
      continue;
    }
    results.push(pass('page.reachable', 1, `GET ${path}`, `HTTP 200, ${r.body.length} bytes`));

    // h1: an SVG logo inside the h1 is an EMPTY h1. This is the exact MotoTerra defect.
    const h1s = tagsInner(r.body, 'h1');
    const h1Texts = h1s.map(textOf).filter(Boolean);
    if (h1s.length === 0) {
      results.push(fail('page.h1', 4, `${path} has a text h1`, 'no <h1> in the document'));
    } else if (h1Texts.length === 0) {
      results.push(fail('page.h1', 4, `${path} has a text h1`, `${h1s.length} <h1> present but none carries text (markup only, e.g. an SVG logo) — this is an empty h1`));
    } else if (h1s.length > 1) {
      results.push(fail('page.h1', 4, `${path} has exactly one h1`, `${h1s.length} found: ${h1Texts.map(t => JSON.stringify(t.slice(0, 40))).join(', ')}`));
    } else {
      results.push(pass('page.h1', 4, `${path} has one text h1`, JSON.stringify(h1Texts[0].slice(0, 70))));
    }

    const title = textOf(tagsInner(r.body, 'title')[0] ?? '');
    if (!title) results.push(fail('page.title', 4, `${path} has a title`, 'empty or missing <title>'));
    else if (title.length > 60) results.push(fail('page.title', 4, `${path} title within 60 chars`, `${title.length} chars: ${JSON.stringify(title)}`));
    else results.push(pass('page.title', 4, `${path} title`, `${title.length} chars: ${JSON.stringify(title)}`));

    const desc = metaContent(r.body, 'name', 'description');
    if (!desc) results.push(fail('page.description', 4, `${path} has a meta description`, 'missing'));
    else if (desc.length > 160) results.push(fail('page.description', 4, `${path} description within 160 chars`, `${desc.length} chars`));
    else results.push(pass('page.description', 4, `${path} description`, `${desc.length} chars`));

    const canon = linkHref(r.body, 'canonical');
    if (!canon) {
      results.push(fail('page.canonical', 4, `${path} has a canonical`, 'no rel=canonical'));
    } else {
      const abs = new URL(canon, url).toString().replace(/\/$/, '');
      const self = url.replace(/\/$/, '');
      if (abs === self) results.push(pass('page.canonical', 4, `${path} canonical is self-referencing`, abs));
      else results.push(fail('page.canonical', 4, `${path} canonical is self-referencing`, `points to ${abs}, page is ${self}`));
    }

    // Content in raw HTML. LLM crawlers download JS and never execute it, so a shell is invisible forever.
    const bodyText = textOf(tagsInner(r.body, 'body')[0] ?? r.body);
    const min = cfg.minRawTextChars ?? 500;
    if (bodyText.length < min) {
      results.push(fail('page.raw-html', 7, `${path} renders content without JS`, `${bodyText.length} chars of text in raw HTML (floor ${min}); every non-Google AI crawler sees only this`));
    } else {
      results.push(pass('page.raw-html', 7, `${path} renders content without JS`, `${bodyText.length} chars of server-rendered text`));
    }

    const { blocks, errors } = jsonLdBlocks(r.body);
    for (const e of errors) results.push(fail('page.jsonld-parses', 4, `${path} JSON-LD parses`, e));
    if (blocks.length === 0 && errors.length === 0) {
      results.push(skip('page.jsonld', 4, `${path} JSON-LD`, 'no ld+json block on this page'));
    }
    for (const node of blocks) {
      const type = Array.isArray(node['@type']) ? node['@type'][0] : node['@type'];
      const required = (cfg.jsonLdRequired ?? {})[type];
      if (!required) { results.push(pass('page.jsonld', 4, `${path} ${type} parses`, 'no required-field policy configured for this type')); continue; }
      const missing = required.filter(k => node[k] === undefined || node[k] === null || node[k] === '');
      if (missing.length) results.push(fail('page.jsonld-fields', 4, `${path} ${type} required fields`, `missing: ${missing.join(', ')}`));
      else results.push(pass('page.jsonld-fields', 4, `${path} ${type} required fields`, required.join(', ')));
    }

    // Link rot silently un-sources a factual claim. This is why every citation is fetched.
    if (cfg.checkCitationsOn?.includes(path)) {
      const links = externalLinks(r.body, new URL(cfg.baseUrl).host);
      const cap = cfg.citationCap ?? 40;
      const checked = links.slice(0, cap);
      if (links.length > cap) {
        results.push(skip('page.citations', 4, `${path} citation cap`, `${links.length} external links found, checking first ${cap}; raise citationCap to cover all (no silent truncation)`));
      }
      for (const link of checked) {
        const lr = await get(link, { timeout: 15000 });
        if (lr.ok && lr.status < 400) results.push(pass('page.citation-live', 4, `citation ${new URL(link).host}`, `${lr.status} ${link}`));
        else results.push(fail('page.citation-live', 4, `citation ${new URL(link).host}`, `${lr.ok ? lr.status : lr.error} ${link} — a rotted citation leaves its factual claim unsourced`));
      }
    }
  }
}

/** Every named AI and search crawler must receive a 200, not a challenge page or a 403. */
async function checkCrawlerAccess(cfg, results) {
  const url = new URL(cfg.crawlerProbePath ?? '/', cfg.baseUrl).toString();
  for (const [name, ua] of CRAWLERS) {
    const r = await get(url, { ua });
    if (r.ok && r.status === 200) results.push(pass('crawler.access', 7, `${name} receives 200`, `${r.status} ${url}`));
    else results.push(fail('crawler.access', 7, `${name} receives 200`, `${r.ok ? 'HTTP ' + r.status : r.error} — a CDN bot rule can 403 AI crawlers while robots.txt still returns 200`));
  }
}

/** A soft 404 tells a crawler an infinite site exists. */
async function checkRealNotFound(cfg, results) {
  const url = new URL(cfg.notFoundProbePath ?? '/__doctor_should_not_exist__', cfg.baseUrl).toString();
  const r = await get(url);
  if (r.ok && r.status === 404) results.push(pass('http.real-404', 4, 'unknown paths return 404', `404 ${url}`));
  else results.push(fail('http.real-404', 4, 'unknown paths return 404', `${r.ok ? 'HTTP ' + r.status : r.error} for a path that does not exist (soft 404)`));
}

/** Place 4: sitemap present, and every URL in it actually resolves. */
async function checkSitemap(cfg, results) {
  if (cfg.sitemap === false) { results.push(skip('sitemap', 4, 'sitemap', 'disabled in config')); return; }
  const url = new URL(cfg.sitemapPath ?? '/sitemap.xml', cfg.baseUrl).toString();
  const r = await get(url);
  if (!r.ok || r.status !== 200) { results.push(fail('sitemap.reachable', 4, 'sitemap.xml', `${r.ok ? 'HTTP ' + r.status : r.error}`)); return; }
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  results.push(pass('sitemap.reachable', 4, 'sitemap.xml', `HTTP 200, ${locs.length} <loc> entries`));
  const cap = cfg.sitemapCap ?? 25;
  const sample = locs.slice(0, cap);
  if (locs.length > cap) {
    results.push(skip('sitemap.urls', 4, 'sitemap URL coverage', `${locs.length} URLs, checking first ${cap}; raise sitemapCap for full coverage (declared, not silent)`));
  }
  for (const loc of sample) {
    const lr = await get(loc, { timeout: 15000 });
    if (lr.ok && lr.status === 200) results.push(pass('sitemap.url-200', 4, `sitemap URL ${new URL(loc).pathname}`, '200'));
    else results.push(fail('sitemap.url-200', 4, `sitemap URL ${new URL(loc).pathname}`, `${lr.ok ? lr.status : lr.error} — a sitemap that lists dead URLs degrades trust in the whole file`));
  }
}

/** Place 7: the self-model resolves, validates, and declares what it is NOT authoritative on. */
async function checkSelfModel(cfg, results) {
  const url = new URL('/.well-known/mrbrix-self.json', cfg.baseUrl).toString();
  const r = await get(url);
  if (!r.ok || r.status !== 200) {
    results.push(fail('self-model.resolves', 7, 'self-model resolves', `${r.ok ? 'HTTP ' + r.status : r.error} at ${url} — place 7 is unmet`));
    return;
  }
  let doc;
  try { doc = JSON.parse(r.body); }
  catch (e) { results.push(fail('self-model.parses', 7, 'self-model parses', e.message)); return; }
  results.push(pass('self-model.resolves', 7, 'self-model resolves', `200 ${url}`));

  if (doc.schema !== 'mrbrix.self/1') {
    results.push(fail('self-model.schema', 7, 'self-model schema', `expected "mrbrix.self/1", got ${JSON.stringify(doc.schema)}`));
  } else {
    results.push(pass('self-model.schema', 7, 'self-model schema', 'mrbrix.self/1'));
  }
  const required = ['property', 'name', 'purpose', 'realm', 'surfaces', 'owns', 'authoritative_on', 'not_authoritative_on', 'depends_on', 'capabilities', 'sense'];
  const missing = required.filter(k => doc[k] === undefined);
  if (missing.length) results.push(fail('self-model.fields', 7, 'self-model required fields', `missing: ${missing.join(', ')}`));
  else results.push(pass('self-model.fields', 7, 'self-model required fields', required.join(', ')));

  // The field almost nobody ships, and the one that earns the trust.
  if (Array.isArray(doc.not_authoritative_on) && doc.not_authoritative_on.length > 0) {
    results.push(pass('self-model.not-authoritative', 7, 'declares what it is NOT authoritative on', `${doc.not_authoritative_on.length} entries`));
  } else {
    results.push(fail('self-model.not-authoritative', 7, 'declares what it is NOT authoritative on', 'empty or absent; refuse-and-point (#21b) has nothing to consult'));
  }

  if (!doc.attestation) results.push(fail('self-model.attestation', 7, 'Identity-signed attestation', 'absent; portfolio membership is a marketing claim rather than a cryptographic one'));
  else results.push(pass('self-model.attestation', 7, 'Identity-signed attestation', 'present (signature verification lands with Identity KMS)'));
}

export async function runLiveChecks(cfg) {
  const results = [];
  await checkCanonicalHost(cfg, results);
  await checkPageContents(cfg, results);
  await checkCrawlerAccess(cfg, results);
  await checkRealNotFound(cfg, results);
  await checkSitemap(cfg, results);
  await checkSelfModel(cfg, results);
  return results;
}
