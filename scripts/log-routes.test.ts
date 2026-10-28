import { readdirSync } from 'node:fs';
import path from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { logRoutes } from '@daisy/logger';

setupRitewayBun();

const root = path.resolve(import.meta.dir, '..');

/**
 * Each page or route handler under an App Router directory, as the pattern
 * Next reports in `onRequestError`'s `routePath`: route groups and parallel
 * slots dropped, dynamic segments kept in brackets.
 */
const appRoutePatterns = (app: string) =>
  (readdirSync(path.join(root, app), { recursive: true }) as string[])
    .filter((file) => /(^|\/)(page\.tsx|route\.ts)$/.test(file))
    .map(
      (file) =>
        `/${file}`
          .replace(/\/(page\.tsx|route\.ts)$/, '')
          .split('/')
          .filter(
            (segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'),
          )
          .join('/') || '/',
    );

test('every App Router pattern a request failure may log is a listed route (ISSUE-832)', () => {
  const unlisted = ['apps/web/src/app', 'apps/admin/src/app']
    .flatMap(appRoutePatterns)
    .filter((pattern) => !logRoutes.has(pattern));
  assert({
    given: 'every page and route handler of the web and admin apps',
    should: 'name a route pattern the logger and the log shipper admit',
    actual: unlisted,
    expected: [],
  });
});
