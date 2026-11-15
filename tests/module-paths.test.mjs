import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = value => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);

test('all public pages resolve their module dependencies, stylesheets and stylesheet assets', () => {
  const visited = new Set();
  function follow(owner, specifier) {
    if (!local(specifier)) return;
    const path = specifier.split(/[?#]/, 1)[0];
    const target = resolve(specifier.startsWith('/') ? root : dirname(owner), decodeURIComponent(path.replace(/^\//, '')));
    assert.ok(target.startsWith(root), `Outside project: ${specifier} from ${relative(root, owner)}`);
    assert.ok(existsSync(target), `Missing ${specifier} from ${relative(root, owner)}`);
    visit(target);
  }
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    if (file.includes('/assets/')) return;
    const extension = extname(file);
    if (!['.html', '.js', '.mjs', '.css'].includes(extension)) return;
    const text = readFileSync(file, 'utf8');
    if (extension === '.html') {
      for (const match of text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)) follow(file, match[1]);
    } else if (extension === '.css') {
      for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) follow(file, match[1]);
    } else {
      for (const match of text.matchAll(/\b(?:from\s*|import\s*\(\s*|loadOptional\s*\(\s*)["'](\.[^"']+)["']/g)) follow(file, match[1]);
    }
  }
  for (const page of ['index.html', 'discovery.html', 'dossier.html', 'route-explorer.html', 'scout.html']) visit(resolve(root, page));
  assert.ok(visited.size > 50, 'The dependency traversal must cover the complete public application');
});
