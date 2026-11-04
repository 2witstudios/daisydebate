import { join, relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { routeExists } from './route-exists';

setupRitewayBun();

const srcDirectory = join(import.meta.dir, '../..');
const appDirectory = join(srcDirectory, 'app');

// A route handler or framework path, not a page.
const notPages = /^\/(api|_next)(\/|$)/;

// `href="/x"`, `href={'/x'}` and `href: '/x'`, with a static path only.
const staticHref = /href(?:=\{?|:\s*)\s*['"](\/[^'"`$]*)['"]/g;

const sourceFiles = [...new Glob('**/*.{ts,tsx}').scanSync(srcDirectory)]
  .filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes('test-'))
  .map((file) => join(srcDirectory, file));

const hrefsOf = (file: string): readonly string[] =>
  [...readFileSync(file, 'utf8').matchAll(staticHref)]
    .map((match) => (match[1] ?? '').split(/[?#]/)[0] ?? '')
    .filter((path) => path !== '' && !notPages.test(path));

describe('internal links', () => {
  test('every static link resolves to a page', () => {
    const dead = sourceFiles.flatMap((file) =>
      hrefsOf(file)
        .filter((path) => !routeExists(appDirectory, path))
        .map((path) => `${relative(srcDirectory, file)}: ${path}`),
    );
    assert({
      given: 'every static href in the app source',
      should: 'point at a route that exists, so no link is a placeholder',
      actual: dead,
      expected: [],
    });
  });
});
