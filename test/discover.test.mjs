import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverIn } from '../src/discover.mjs';

// The sweep could only ever see ONE property per directory, and nothing tested it.
//
// A repo serving three domains was measured on one of them; the other two passed nothing
// and failed nothing, which reads exactly like a clean bill of health. 4grand found it:
// thegrand.nyc is a live campaign and courts.tennis is the only indexed surface in that
// project, and neither was in the sweep at all.
//
// A discovery change landing in a sweep that has no tests is the shape this tool exists to
// catch, so these fail in both directions: too few found, and too many.

function fixture(spec) {
  const root = mkdtempSync(join(tmpdir(), 'doctor-discover-'));
  for (const [dir, files] of Object.entries(spec)) {
    mkdirSync(join(root, dir), { recursive: true });
    for (const f of files) writeFileSync(join(root, dir, f), '{}');
  }
  return root;
}

test('finds every doctor config in one directory, not just the first', () => {
  const root = fixture({
    app: ['doctor.config.json', 'doctor.nyc.config.json', 'doctor.courts.config.json'],
  });
  const found = discoverIn(root);
  assert.equal(found.length, 3);
  assert.deepEqual(found.map(f => f.name).sort(), ['app', 'app:courts', 'app:nyc']);
  // The filename must travel with the property: the runner spawns with it, and hard-coding
  // 'doctor.config.json' there is the other half of the same bug.
  assert.deepEqual(
    found.map(f => f.config).sort(),
    ['doctor.config.json', 'doctor.courts.config.json', 'doctor.nyc.config.json'],
  );
});

test('a single-config repo still yields exactly one, named after the directory', () => {
  // The failure in the other direction: a pattern loose enough to find three where there
  // is one would rename every existing property and orphan its history.
  const found = discoverIn(fixture({ solo: ['doctor.config.json'] }));
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'solo');
  assert.equal(found[0].config, 'doctor.config.json');
});

test('ignores the example config and anything that is not a doctor config', () => {
  const found = discoverIn(fixture({
    tool: ['doctor.config.example.json', 'package.json', 'doctorconfig.json', 'README.md'],
  }));
  assert.equal(found.length, 0);
});

test('a directory with no config is not a property', () => {
  assert.equal(discoverIn(fixture({ empty: [] })).length, 0);
});

test('--only filters on the DIRECTORY and keeps all of its properties', () => {
  // `--only 4grand` must mean "that repo", not "that one property of it".
  const root = fixture({
    keep: ['doctor.config.json', 'doctor.nyc.config.json'],
    drop: ['doctor.config.json'],
  });
  const found = discoverIn(root, ['keep']);
  assert.deepEqual(found.map(f => f.name), ['keep', 'keep:nyc']);
});
