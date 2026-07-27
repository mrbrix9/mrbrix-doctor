#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runDoctor, printReport } from '../src/engine.mjs';
import { writeSelfModel } from '../src/selfmodel.mjs';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};
const has = name => argv.includes(`--${name}`);

if (has('help')) {
  console.log(`
  doctor  —  proprioception for an MR Brix property

    --config <path>   config file (default: doctor.config.json in cwd)
    --root <path>     repository root to scan (default: cwd)
    --json <path>     write the machine-readable verdict here
    --live-only       skip repository assertions
    --repo-only       skip live-surface assertions
    --evals           EXECUTE the golden sets against the AI surfaces.
                      Off by default: a live adapter spends real inference budget.
                      Without it, golden sets are only asserted to exist and to
                      cover both failure modes.
    --dry-run         load and validate the config, run nothing

  Exit code is the verdict. Nonzero fails the build.  Playbook v1.15 §5.9.
`);
  process.exit(0);
}

const root = resolve(arg('root', process.cwd()));
const configPath = resolve(arg('config', 'doctor.config.json'));

if (!existsSync(configPath)) {
  console.error(`\n  no config at ${configPath}\n  copy doctor.config.example.json and set property + baseUrl.\n`);
  process.exit(2);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`\n  config at ${configPath} is not valid JSON: ${e.message}\n`);
  process.exit(2);
}

for (const required of ['property', 'baseUrl']) {
  if (!config[required]) {
    console.error(`\n  config is missing required field "${required}"\n`);
    process.exit(2);
  }
}

// `doctor selfmodel` regenerates /.well-known/mrbrix-self.json from the repository.
// Run it in predeploy, before the working tree is uploaded.
if (argv[0] === 'selfmodel') {
  try {
    const { path, model } = writeSelfModel(root, config);
    const undeclared = model.capabilities.filter(c => c.tier === 'undeclared').length;
    console.log(`\n  wrote ${path}`);
    console.log(`  ${model.capabilities.length} capabilities, ${model.depends_on.length} dependencies, sense: ${model.sense.emitting ? model.sense.classes.join('+') : 'not emitting'}`);
    if (undeclared) console.log(`  ${undeclared} capabilities have no declared access tier; they say "undeclared" rather than guessing public\n`);
    else console.log('');
    process.exit(0);
  } catch (e) {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  }
}

if (has('dry-run')) {
  console.log(`\n  config OK: ${config.property} at ${config.baseUrl}`);
  console.log(`  pages: ${(config.pages ?? ['/']).join(', ')}`);
  console.log(`  ai surfaces: ${(config.aiSurfaces ?? []).map(s => s.name).join(', ') || 'none declared'}\n`);
  process.exit(0);
}

const report = await runDoctor({
  root,
  config,
  skipLive: has('repo-only'),
  skipRepo: has('live-only'),
  withEvals: has('evals'),
});

printReport(report);

const jsonOut = arg('json');
if (jsonOut) {
  writeFileSync(resolve(jsonOut), JSON.stringify(report, null, 2));
  console.log(`  verdict written to ${resolve(jsonOut)}\n`);
}

process.exit(report.verdict === 'pass' ? 0 : 1);
