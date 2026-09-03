import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Find every doctor config under a root, one directory deep.
 *
 * ONE REPO CAN SERVE SEVERAL PROPERTIES, and the sweep used to be unable to see them: it
 * tested one exact path, `<dir>/doctor.config.json`. So a repo answering for three domains
 * was measured on one, and the other two passed nothing and failed nothing. 4grand is the
 * case that found it — grand.tennis was swept while thegrand.nyc, a live campaign, and
 * courts.tennis, the only indexed surface in that project, were invisible.
 *
 * `doctor.<slug>.config.json` beside the main one is a second property, named
 * `<dir>:<slug>`. The suffix is not cosmetic: the name keys both the temp verdict file and
 * every printed row, so two properties in one directory would otherwise overwrite each
 * other's results and report ambiguously.
 *
 * `onlyNames` filters on the DIRECTORY, so `--only 4grand` runs all of that repo's
 * properties, which is what anyone typing it means.
 *
 * Lives here rather than in bin/portfolio.mjs so it can be tested without running a sweep:
 * importing that file executes one.
 */
export function discoverIn(rootDir, onlyNames = []) {
  const out = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (onlyNames.length && !onlyNames.includes(entry.name)) continue;
    const dir = join(rootDir, entry.name);

    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue; // an unreadable directory is not a property
    }

    for (const file of files.sort()) {
      // The example config ships in this repo and is not a property.
      if (file === 'doctor.config.example.json') continue;
      const m = /^doctor(?:\.([a-z0-9-]+))?\.config\.json$/.exec(file);
      if (!m) continue;
      out.push({ name: m[1] ? `${entry.name}:${m[1]}` : entry.name, dir, config: file });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
