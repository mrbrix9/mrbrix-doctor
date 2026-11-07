import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSelfModel, writeSelfModel } from '../src/selfmodel.mjs';

// The self model is published at /.well-known/mrbrix-self.json and read by agents. Two
// silent defaults were found 2026-11-06: a capability written as a plain string was
// published as { path: undefined, description: null } (4grand, visdx), and a capability
// with no declared tier was published as "public". Both lose meaning without a word.

const declared = {
  purpose: 'p', realm: 'mrbrix', owns: ['o'], authoritative_on: ['a'], not_authoritative_on: ['n'],
};

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'selfmodel-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '16.0.0' } }));
  mkdirSync(join(root, 'app/api/mcp'), { recursive: true });
  writeFileSync(join(root, 'app/api/mcp/route.ts'), 'export const POST = () => {}');
  return root;
}
const cfg = caps => ({ property: 'x', baseUrl: 'https://x.test', self: { ...declared, capabilities: caps } });

describe('capabilities are published with their meaning, or not at all', () => {
  test('a well-formed capability is published as declared', () => {
    const { model, malformed } = buildSelfModel(repo(), cfg([{ path: '/api/mcp', tier: 'public', description: 'd' }]));
    assert.deepEqual(malformed, []);
    assert.deepEqual(model.capabilities, [{ path: '/api/mcp', tier: 'public', description: 'd' }]);
  });

  test('a capability written as a plain string fails the build instead of losing its sentence', () => {
    const root = repo();
    assert.equal(buildSelfModel(root, cfg(['check_ai_readiness'])).malformed.length, 1);
    assert.throws(() => writeSelfModel(root, cfg(['check_ai_readiness'])), /not an object/);
  });

  test('a capability without a route path or a description is refused', () => {
    const root = repo();
    assert.throws(() => writeSelfModel(root, cfg([{ description: 'd' }])), /not a route path/);
    assert.throws(() => writeSelfModel(root, cfg([{ path: '/api/mcp' }])), /no description/);
  });

  test('an undeclared tier says "undeclared", never "public"', () => {
    const { model } = buildSelfModel(repo(), cfg([{ path: '/api/mcp', description: 'd' }]));
    assert.equal(model.capabilities[0].tier, 'undeclared');
  });

  test('a capability that does not exist in the repository still fails the build', () => {
    assert.throws(() => writeSelfModel(repo(), cfg([{ path: '/api/nope', description: 'd' }])), /do not exist/);
  });

  test('a Next.js property gets the file in public/.well-known, where it is served', () => {
    const root = repo();
    const { path } = writeSelfModel(root, cfg([]));
    assert.equal(path, join(root, 'public/.well-known/mrbrix-self.json'));
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).schema, 'mrbrix.self/1');
  });

  test('a property that calls a model through the AI SDK depends on a model provider', () => {
    const root = repo();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '16.0.0', ai: '6.0.0' } }));
    assert.ok(buildSelfModel(root, cfg([])).model.depends_on.includes('model provider'));
  });
});
