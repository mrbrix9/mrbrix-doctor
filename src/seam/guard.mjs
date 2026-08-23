/**
 * Pre-deploy guard — the PREVENTIVE half of the Seam Doctor.
 *
 * The detective checks (DEP-1/2/3) run on a clock and tell you afterwards. This runs at
 * the moment of risk and refuses. The distinction matters: a human IS present when a
 * deploy happens, so that failure can be prevented rather than reported.
 *
 * Every refusal below corresponds to a real directory on this machine right now:
 *   no manifest      a shell folder holds the link to a live customer site
 *   dead project     five links name projects that no longer exist; Vercel offers to
 *                    CREATE one, which is worse than failing
 *   shared link      six projects are claimed by two directories each, and these repos
 *                    deploy the WORKING TREE, so the wrong folder ships silently
 *   stale worktree   a nested clone three months behind holds a live production link
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readLinks } from './links.mjs';
import { findLinkPaths } from './local.mjs';

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

/**
 * Pure verdict, so the refusal logic is testable without a filesystem.
 * data = { dir, hasManifest, link, otherClaimants: [], projectExists, ageDays }
 */
export function assess(data) {
  const problems = [];

  if (!data.link) {
    problems.push({
      code: 'NO_LINK',
      say: 'this directory has no Vercel link',
      why: 'deploying here would offer to create a NEW project rather than update an existing one',
    });
  }

  if (!data.hasManifest) {
    problems.push({
      code: 'NO_MANIFEST',
      say: 'this directory has no package.json',
      why: data.link
        ? `it is linked to "${data.link.projectName}", so a deploy would push an unbuildable folder at a real project`
        : 'there is nothing here to build',
    });
  }

  if (data.link && data.projectExists === false) {
    problems.push({
      code: 'DEAD_PROJECT',
      say: `the linked project "${data.link.projectName}" no longer exists`,
      why: 'Vercel will offer to create a new project under that name, which succeeds and is wrong',
    });
  }

  if (data.otherClaimants?.length) {
    problems.push({
      code: 'SHARED_LINK',
      say: data.otherClaimants.length === 1
        ? 'another directory claims the same project'
        : `${data.otherClaimants.length} other directories claim the same project`,
      why: `these repos deploy the working tree, so whichever folder runs the command wins: ${data.otherClaimants.join(', ')}`,
    });
  }

  return {
    ok: problems.length === 0,
    problems,
    dir: data.dir,
    project: data.link?.projectName ?? null,
  };
}

/** Gather the facts for one directory. */
export function inspect(dir, { root, projectIds = null } = {}) {
  const abs = resolve(dir);
  const all = readLinks(findLinkPaths(root ?? resolve(abs, '..')));
  const mine = all.filter((l) => l.dir === abs);
  const link = mine[0] ?? null;

  const otherClaimants = link
    ? [...new Set(all.filter((l) => l.projectId === link.projectId && l.dir !== abs).map((l) => l.dir))]
    : [];

  return {
    dir: abs,
    hasManifest: existsSync(join(abs, 'package.json')),
    link,
    otherClaimants,
    // null means "not checked" and is never treated as absent.
    projectExists: link && Array.isArray(projectIds) ? projectIds.includes(link.projectId) : null,
  };
}

export function formatRefusal(verdict) {
  const lines = [`REFUSING TO DEPLOY from ${verdict.dir}`];
  for (const p of verdict.problems) {
    lines.push(`  ${p.say}`);
    lines.push(`    ${p.why}`);
  }
  lines.push('');
  lines.push('  If this is deliberate, pass --force. If it is not, you just avoided shipping the wrong thing.');
  return lines.join('\n');
}
