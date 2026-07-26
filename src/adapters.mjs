// How the runner reaches an AI surface. Three adapters, because the portfolio's surfaces
// are reached three different ways and none of them should require rewriting the scorer.

import { resolve } from 'node:path';

function dotPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function render(template, input) {
  if (typeof template === 'string') return template.replaceAll('{{input}}', input);
  if (Array.isArray(template)) return template.map(t => render(t, input));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, render(v, input)]));
  }
  return template;
}

/** POST the input to a live endpoint. Costs money and is therefore opt-in. */
function httpAdapter(spec) {
  return async input => {
    const res = await fetch(spec.url, {
      method: spec.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
      body: JSON.stringify(render(spec.bodyTemplate ?? { input: '{{input}}' }, input)),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return { text: await res.text(), raw: null, status: res.status };
    const json = await res.json();
    const picked = dotPath(json, spec.responsePath);
    return { text: typeof picked === 'string' ? picked : JSON.stringify(picked ?? json), raw: json, status: res.status };
  };
}

/** Import a function from the property's own source. No network, no spend. */
function moduleAdapter(spec, root) {
  return async input => {
    const mod = await import(resolve(root, spec.path));
    const fn = spec.export ? mod[spec.export] : mod.default;
    if (typeof fn !== 'function') throw new Error(`${spec.path} does not export a callable ${spec.export ?? 'default'}`);
    const out = await fn(input);
    return { text: typeof out === 'string' ? out : JSON.stringify(out), raw: out, status: 200 };
  };
}

/** Fixed responses declared in the golden set. Used to prove the SCORER itself works. */
function mockAdapter(spec) {
  return async input => {
    const text = spec.responses?.[input];
    if (text === undefined) throw new Error(`mock adapter has no response for input ${JSON.stringify(input)}`);
    return { text: String(text), raw: text, status: 200 };
  };
}

export function makeAdapter(spec, root) {
  if (!spec || !spec.type) throw new Error('golden set has no adapter');
  if (spec.type === 'http') return httpAdapter(spec);
  if (spec.type === 'module') return moduleAdapter(spec, root);
  if (spec.type === 'mock') return mockAdapter(spec);
  throw new Error(`unknown adapter type ${spec.type}`);
}
