import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isGuardedPath } from './decision';

setupRitewayBun();

const appDir = join(import.meta.dir, '../../app');

/** `app/lobby/[id]/page.tsx` → `/lobby/[id]`; route groups `(x)` vanish. */
const routeOf = (file: string): string =>
  `/${file
    .replace(/\/?page\.tsx$/, '')
    .split('/')
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
    .join('/')}`;

const pages = [...new Glob('**/page.tsx').scanSync(appDir)].map((file) => ({
  file,
  route: routeOf(file),
  source: readFileSync(join(appDir, file), 'utf8'),
}));

describe('guarded pages', () => {
  test('every page in a guarded area rechecks the session for its own root', () => {
    const guarded = pages.filter(({ route }) => isGuardedPath(route));
    const unguarded = guarded
      .filter(({ route, source }) => {
        const root = route.split('/')[1];
        return !new RegExp(
          `requireAccess\\(\\s*['\`]/${root}[^'\`]*['\`],\\s*searchParams`,
        ).test(source);
      })
      .map(({ file }) => file);
    assert({
      given: `the ${guarded.length} page files under the six guarded roots`,
      should:
        'each call requireAccess with its own root and its search params (the requirement comes from the guarded-area table)',
      actual: { atLeastTheRoots: guarded.length >= 6, unguarded },
      expected: { atLeastTheRoots: true, unguarded: [] },
    });
  });

  test('public spectator pages do not demand an account', () => {
    const publicRoutes = ['/', '/watch', '/leaderboard', '/tournaments'];
    assert({
      given: 'the public spectator pages',
      should: 'not call requireAccess',
      actual: pages
        .filter(({ route }) => publicRoutes.includes(route))
        .filter(({ source }) => source.includes('requireAccess('))
        .map(({ file }) => file),
      expected: [],
    });
  });
});
