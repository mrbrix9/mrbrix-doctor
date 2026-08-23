/**
 * Vercel link discovery.
 *
 * TWO FORMATS EXIST and a sweep for one misses the other. This cost a full directory of
 * findings during the 2026-08-22 audit:
 *
 *   .vercel/project.json   { projectId, orgId, projectName }
 *   .vercel/repo.json      { remoteName, projects: [{ id, name, directory, orgId }] }
 *
 * repo.json has NO projectId or projectName key at all. Two live links (afterwards, mxta)
 * exist ONLY in that format, and the Motoverse root carries BOTH files naming DIFFERENT
 * projects. Any tool that reads one format reports a clean sweep over an incomplete list,
 * which is the exact failure shape this engine exists to remove.
 */
import { readFileSync } from 'node:fs';

/** Parse either format into a flat list of {dir, format, projectId, projectName}. */
export function parseLinkFile(path, contents) {
  const dir = path.replace(/\/\.vercel\/(project|repo)\.json$/, '');
  let j;
  try { j = JSON.parse(contents); } catch { return []; }

  if (path.endsWith('project.json')) {
    if (!j.projectId) return [];
    return [{ dir, format: 'project.json', projectId: j.projectId, projectName: j.projectName ?? null }];
  }
  // repo.json: one file, possibly many projects.
  const out = [];
  for (const p of j.projects ?? []) {
    if (!p.id) continue;
    out.push({ dir, format: 'repo.json', projectId: p.id, projectName: p.name ?? null, subdir: p.directory ?? null });
  }
  return out;
}

export function readLinks(paths) {
  const links = [];
  for (const p of paths) {
    try { links.push(...parseLinkFile(p, readFileSync(p, 'utf8'))); } catch { /* unreadable link is reported by DEP-1 as missing */ }
  }
  return links;
}
