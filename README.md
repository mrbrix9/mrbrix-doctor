# @mrbrix/doctor

Proprioception for an MR Brix property. Playbook v1.15 §5.9, Build Discipline #22.

The sense layer's three classes all point outward and need a visitor before anything is felt.
This is the fourth class, and its subject is the property itself: is it where it thinks it is,
and is it obeying the rules it says it obeys.

**The exit code is the verdict.** Nonzero fails the build.

```bash
node bin/doctor.mjs --config doctor.config.json
node bin/doctor.mjs --config doctor.config.json --repo-only
node bin/doctor.mjs --config doctor.config.json --json .doctor/verdict.json
```

## Why it runs inside the repository

A central scanner sees only a property's HTTP surface. It cannot see an import graph, a build
command, a migration directory, or an evaluation result, and those are exactly where the
portfolio's real failures have lived. A scanner that cannot see them returns a confident green
over a property that is quietly broken, which is the MotoTerra failure at portfolio scale.

Discipline #19 applied to verification itself: the checker lives in the primitive, not beside it.

## What it asserts

**Contents, never presence.** Every check parses what is actually there.

| Group | Examples |
|---|---|
| Live surface | text `h1` (an SVG logo in the `h1` is an empty `h1`), one per page, title and description length, self-referencing canonical, one-hop redirects to the canonical host, real 404s, JSON-LD parses with required fields, **every outbound citation fetched**, content present in raw HTML with no JS, every named AI and search crawler receiving 200, every sitemap URL resolving |
| Repository | no schema push in a build or deploy command, migration history exists, no provider SDK imported outside the §6.2 gateway wrapper, a declared inference spend ceiling |
| AI truthfulness | a golden set exists per declared AI surface and covers both failure modes: **fabrication traps** (inputs whose correct answer is absence) and **abstention cases** (inputs outside declared authority where refuse-and-point must fire) |
| Place 7 | `/.well-known/mrbrix-self.json` resolves, validates against `mrbrix.self/1`, and declares `not_authoritative_on` |

**No silent caps.** Where coverage is bounded (citations, sitemap URLs), the bound is reported as a
`skip` line naming what was not checked. A truncated run must never read as a complete one.

**The evidence is the receipt.** Every result prints the URL, the status code, or the file and line
of source that produced it. A verdict without evidence is a claim, and claims are the thing this
package exists to replace.

## Zero dependencies, on purpose

Consumed by eleven repositories on different toolchains. Plain ESM, no build step, Node 20+.
A dependency tree is a reason not to adopt it.

## Config

Copy `doctor.config.example.json` to `doctor.config.json` in the property root. Only `property`
and `baseUrl` are required.

## Verified runs, 2026-07-26

First run of the engine, recorded rather than summarized.

- **mototerra** (live, `--live-only`): 32 passed, 1 failed. The only failure is the self-model 404,
  which is place 7 being unbuilt portfolio-wide and is expected. The SEO defects from the
  2026-07 scar are confirmed repaired: text `h1` present, all six sitemap URLs 200, all six
  outbound citations 200, all seven crawlers 200, 4613 chars of server-rendered text.
- **T1** (`--repo-only`): caught `src/lib/claude.ts` importing the provider SDK outside the
  gateway wrapper, the known §6.2 violation, from the code rather than from a note.
- **visdx / llm-visibility** (`--repo-only`): caught `prisma db push` in `vercel-build` with no
  `prisma/migrations/`, the live production DDL hazard, plus the same gateway violation.

Both repository violations were previously known and written down. Neither had ever failed
anything. That is the difference this package makes.

## Golden sets

`--evals` executes them. Off by default, because a live adapter spends real inference budget;
without the flag the engine only asserts that a set exists and covers both failure modes.

Three adapters: `http` (POST to a live endpoint), `module` (import a function from the property's
own source, no network and no spend), and `mock` (fixed responses, used to test the scorer itself).

Four expectations:

| Expectation | Passes when |
|---|---|
| `absence` | the response states absence explicitly, and with `forbidValues: true` emits no concrete value. **A response that hedges and then produces a number anyway fails**, because that is the exact shape of the live-scoreboard fabrication |
| `refuse-and-point` | the response declines **and** names who owns the question. Declining alone fails: a refusal that strands the person is worse than an answer |
| `contains` | required grounding or provenance is present |
| `mustNot` | applies to any case; a forbidden string fails it outright |

The numeric heuristic is opt-in per case rather than automatic. "Round 1" and "-3" are both
digits, and only the case author knows which one is the fabrication. A scorer that guesses
cries wolf, and a check nobody trusts is a check nobody runs.

### The scorer is itself tested

`fixtures/honest.golden.json` and `fixtures/fabricating.golden.json` hold the same four cases
answered two ways. Verified 2026-07-26: **4 of 4 honest cases pass, 4 of 4 fabricating cases
fail**, each with a distinct and correct reason (hedged fabrication, answered outside authority,
declined without pointing, missing provenance). If any fabricating case ever passes, the scorer
is broken and must not be trusted on a real surface.

```bash
node bin/doctor.mjs --config fixtures/selftest.config.json --repo-only --evals
```

## Not yet built

Named rather than implied.

- T1 emission of `class: "proprioception"` (blocked: T1's migration is not applied to a live database)
- `health` block in the self-model (blocked: no property publishes a self-model yet)
- No golden set exists for any real surface yet. The runner works; the sets have to be authored
  per surface, and authoring them is a judgment task, not a generation task
- Place 3 and place 5 assertions (analytics tag firing, CMS `status: wired`) need credentialed API calls
- Injection red-team assertions for the allied agent tier
