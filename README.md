# @mrbrix/doctor

A property senses itself. One assertion engine, run inside the repository, where the exit code
is the verdict.

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
over a property that is quietly broken.

The governing idea: a body does not decide to place a nerve in its leg. If someone has to
remember to run the check, the check is in the wrong place.

## What it asserts

**Contents, never presence.** Every check parses what is actually there.

| Group | Examples |
|---|---|
| Live surface | text `h1` (an SVG logo in the `h1` is an empty `h1`), one per page, title and description length, self-referencing canonical, one-hop redirects to the canonical host, real 404s, JSON-LD parses with required fields, **every outbound citation fetched**, content present in raw HTML with no JS, every named AI and search crawler receiving 200, every sitemap URL resolving |
| Repository | no schema push in a build or deploy command, migration history exists, no provider SDK imported outside your gateway wrapper, a declared inference spend ceiling |
| AI truthfulness | a golden set exists per declared AI surface and covers both failure modes: **fabrication traps** (inputs whose correct answer is absence) and **abstention cases** (inputs outside declared authority where refuse-and-point must fire) |
| Self-model | `/.well-known/mrbrix-self.json` resolves, validates against `mrbrix.self/1`, and declares `not_authoritative_on` |

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

## What it catches that a checklist does not

On its first run across a portfolio, the engine found three classes of defect that had all been
written down somewhere and had never failed anything:

- A homepage whose `<h1>` contained only an SVG logo. The page scored well on every tool that
  checks whether an `h1` is *present*, and it targeted the site's primary keyword with no
  heading text at all.
- A schema push inside a deploy command, applying unreviewed DDL to a production database with
  no migration file and no rollback path.
- A model-provider SDK imported outside the wrapper that was supposed to make the provider a
  swappable config value.

None of the three is visible in a screenshot, and none would fail a build. That gap is the
reason this exists.

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

### Not every surface is the same kind

Each entry in `aiSurfaces` may declare a `kind`, and coverage is judged by what that kind can
get wrong:

| `kind` | What it is | Its set must hold |
|---|---|---|
| `answers` (default) | responds to people | fabrication traps **and** `refuse-and-point` cases |
| `guard` | answers nobody: accepts or rejects content another step produced | fabrication traps; every case `expect: "json"`; and a `why` |

```json
{ "name": "ace-framing", "kind": "guard", "why": "vets one generated line before it posts; never answers a person", "goldenSet": "doctor/ace.golden.json" }
```

A guard declaration is checked, not trusted: no `why` fails; a non-`json` case fails; and at
run time a "guard" that returns prose fails every case. An unknown kind fails, so a typo can
never loosen the rule. Undeclared surfaces keep the full rule, so nothing changes for a
property until it says what its surface is. The rule lives once, in
`src/checks/surface-kind.mjs`, called by both the repo check and the runner.

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

- Emission of the verdict to a telemetry sink as its own signal class
- A `health` block inside the self-model, so a property's own compliance is part of what it
  publishes about itself
- Analytics-tag and CMS-wiring assertions, which need credentialed API calls rather than a fetch
- Injection red-teaming for authenticated agent surfaces

Golden sets are per-surface by nature: the runner is general, but deciding what a given surface
must never claim is a judgment task, not a generated one.
