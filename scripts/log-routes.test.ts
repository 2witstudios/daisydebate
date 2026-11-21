import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { logRoutes } from '@daisy/logger';
import { appRoutePatterns, GENERATED, renderAppRoutes } from './log-routes';

setupRitewayBun();

const root = path.resolve(import.meta.dir, '..');

test('the generated App Router patterns are fresh', () => {
  assert({
    given: 'the pages and route handlers of the web and admin apps today',
    should: `equal ${GENERATED}; run \`bun log:routes\` after adding or removing a route`,
    actual: readFileSync(path.join(root, GENERATED), 'utf8'),
    expected: renderAppRoutes(),
  });
});

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
