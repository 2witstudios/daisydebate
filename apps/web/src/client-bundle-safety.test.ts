import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const web = resolve(import.meta.dir, '..');
const repo = resolve(web, '../..');

/** Imports a browser chunk can never load: the database driver and its runtime. */
const SERVER_ONLY = new Set(['@daisy/db', 'bun']);

const workspaceExports = new Map<string, Record<string, string>>(
  ['packages', 'apps'].flatMap((group) =>
    [...new Bun.Glob(`${group}/*/package.json`).scanSync(repo)].map(
      (manifest) => {
        const { name, exports } = JSON.parse(
          readFileSync(join(repo, manifest), 'utf8'),
        ) as { name: string; exports?: Record<string, string> | string };
        const map =
          typeof exports === 'string' ? { '.': exports } : (exports ?? {});
        return [
          name,
          Object.fromEntries(
            Object.entries(map).map(([key, path]) => [
              key,
              join(repo, dirname(manifest), path),
            ]),
          ),
        ] as const;
      },
    ),
  ),
);

const asFile = (base: string) =>
  [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

const resolveImport = (from: string, specifier: string) => {
  if (specifier.startsWith('.'))
    return asFile(resolve(dirname(from), specifier));
  if (specifier.startsWith('@/'))
    return asFile(join(web, 'src', specifier.slice(2)));
  const [scope, name, ...rest] = specifier.split('/');
  const exports = workspaceExports.get(`${scope}/${name}`);
  return exports?.[rest.length ? `./${rest.join('/')}` : '.'];
};

/** Value imports, re-exports and dynamic imports; type-only imports erase. */
const specifiersOf = (file: string) =>
  [
    ...readFileSync(file, 'utf8').matchAll(
      /(?:^\s*(?:import|export)\s+(?!type\s)[^'";]*?from\s+|^\s*import\s+|\bimport\()\s*['"]([^'"]+)['"]/gm,
    ),
  ].map((match) => match[1]!);

/** Every server-only import reached from a client entry, as `entry -> … -> import`. */
function serverOnlyReached(entry: string): string[] {
  const parents = new Map<string, string>();
  const queue = [entry];
  const seen = new Set(queue);
  const found: string[] = [];
  const pathTo = (file: string) => {
    const path = [file];
    for (let at = file; parents.has(at);) path.unshift((at = parents.get(at)!));
    return path.map((part) => part.replace(`${repo}/`, '')).join(' -> ');
  };
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of specifiersOf(file)) {
      if (SERVER_ONLY.has(specifier)) {
        found.push(`${pathTo(file)} -> ${specifier}`);
        continue;
      }
      const next = resolveImport(file, specifier);
      if (!next || seen.has(next) || !/\.tsx?$/.test(next)) continue;
      seen.add(next);
      parents.set(next, file);
      queue.push(next);
    }
  }
  return found;
}

const clientEntries = [...new Bun.Glob('src/**/*.{ts,tsx}').scanSync(web)]
  .filter((file) => !/\.test(-support)?\.tsx?$/.test(file))
  .map((file) => join(web, file))
  .filter((file) => /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')));

test('the guard finds the client components it walks', () => {
  assert({
    given: "the src tree scanned for 'use client' modules",
    should:
      'find at least 100, so the graph check below cannot pass on an empty set',
    actual: clientEntries.length >= 100,
    expected: true,
  });
});

test('no client component reaches the database driver', () => {
  assert({
    given: `every 'use client' module (${clientEntries.length}) and its import graph, through workspace package exports`,
    should:
      'never import the @daisy/db root or bun, which break the browser chunk (#473: preference-form.tsx -> server/http.ts)',
    actual: clientEntries.flatMap(serverOnlyReached),
    expected: [],
  });
});
