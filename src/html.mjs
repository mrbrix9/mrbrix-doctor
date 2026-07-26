// Minimal HTML introspection. No dependencies on purpose: this package is consumed by
// eleven repositories on different toolchains, and a dependency tree is a reason not to adopt it.

/** Strip tags/comments/scripts and collapse whitespace. */
export function textOf(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All occurrences of a tag, returning inner HTML. */
export function tagsInner(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/** First matching attribute value of a tag selected by an attribute filter. */
export function metaContent(html, attr, value) {
  const re = new RegExp(`<meta\\b[^>]*${attr}=["']${value}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return null;
  const c = tag[0].match(/content=["']([\s\S]*?)["']/i);
  return c ? c[1].trim() : null;
}

export function linkHref(html, rel) {
  const re = new RegExp(`<link\\b[^>]*rel=["']${rel}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return null;
  const h = tag[0].match(/href=["']([^"']+)["']/i);
  return h ? h[1].trim() : null;
}

/** Every application/ld+json block, parsed. Returns {ok, blocks[], errors[]}. */
export function jsonLdBlocks(html) {
  const blocks = [];
  const errors = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && node['@graph'] && Array.isArray(node['@graph'])) blocks.push(...node['@graph']);
        else blocks.push(node);
      }
    } catch (e) {
      errors.push(raw.slice(0, 120) + ' ... ' + e.message);
    }
  }
  return { blocks, errors };
}

/** Absolute external hrefs found in the document body. */
export function externalLinks(html, baseHost) {
  const out = new Set();
  const re = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1]);
      if (u.host !== baseHost) out.add(u.toString());
    } catch { /* malformed href, ignored */ }
  }
  return [...out];
}
