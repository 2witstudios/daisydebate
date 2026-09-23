import { join } from 'node:path';
import { mock } from 'bun:test';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isGuardedPath } from './decision';
import judge from '../../app/(shell)/judge/page';
import lobby from '../../app/(shell)/lobby/page';
import play from '../../app/(shell)/play/page';
import ranked from '../../app/(shell)/ranked/page';
import recordings from '../../app/(shell)/recordings/page';
import settings from '../../app/(shell)/settings/page';
import settingsSecurity from '../../app/(shell)/settings/security/page';
import home from '../../app/(shell)/page';
import watch from '../../app/(shell)/watch/page';
import leaderboard from '../../app/(shell)/leaderboard/page';
import tournaments from '../../app/(shell)/tournaments/page';

setupRitewayBun();

const appDir = join(import.meta.dir, '../../app');

/** `app/lobby/[id]/page.tsx` → `/lobby/[id]`; route groups `(x)` vanish. */
const routeOf = (file: string): string =>
  `/${file
    .replace(/\/?page\.tsx$/, '')
    .split('/')
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
    .join('/')}`;

// Every page renders with a recording guard in place of the real one (which
// reads the request's cookies through the process app): the test invokes
// the page itself and observes what it asks the guard for.
const guardCalls: Array<{ path: string; searchParams: unknown }> = [];
mock.module(join(import.meta.dir, '../../lib/access.ts'), () => ({
  requireAccess: async (path: string, searchParams: unknown) => {
    guardCalls.push({ path, searchParams });
    return { state: 'anonymous' };
  },
}));

type Page = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => unknown;

// The pages this suite renders, by file: every guarded page and every public
// spectator page. The tests fail on a page the glob finds but this misses.
const rendered: Readonly<Record<string, Page>> = {
  '(shell)/judge/page.tsx': judge as Page,
  '(shell)/lobby/page.tsx': lobby as Page,
  '(shell)/play/page.tsx': play as Page,
  '(shell)/ranked/page.tsx': ranked as Page,
  '(shell)/recordings/page.tsx': recordings as Page,
  '(shell)/settings/page.tsx': settings as Page,
  '(shell)/settings/security/page.tsx': settingsSecurity as Page,
  '(shell)/page.tsx': home as Page,
  '(shell)/watch/page.tsx': watch as Page,
  '(shell)/leaderboard/page.tsx': leaderboard as Page,
  '(shell)/tournaments/page.tsx': tournaments as Page,
};

/** What a page asked the guard when rendered with its own search params. */
const guardRequestsOf = async (file: string) => {
  const page = rendered[file];
  if (!page) return [{ root: 'not rendered by this suite', file }];
  const searchParams = Promise.resolve({ from: 'test' });
  guardCalls.length = 0;
  await page({
    params: Promise.resolve({ username: 'someone', id: 'x' }),
    searchParams,
  });
  return guardCalls.map((call) => ({
    root: call.path.split('/')[1],
    ownSearchParams: call.searchParams === searchParams,
  }));
};

/** Renders pages one at a time: they share the recording guard. */
const requestsOf = async (files: readonly { file: string }[]) => {
  const results: Array<{
    file: string;
    requests: Awaited<ReturnType<typeof guardRequestsOf>>;
  }> = [];
  for (const { file } of files)
    results.push({ file, requests: await guardRequestsOf(file) });
  return results;
};

const pages = [...new Glob('**/page.tsx').scanSync(appDir)]
  .map((file) => ({ file, route: routeOf(file) }))
  .sort((a, b) => a.file.localeCompare(b.file));

describe('guarded pages', () => {
  test('every page in a guarded area rechecks the session for its own root', async () => {
    const guarded = pages.filter(({ route }) => isGuardedPath(route));
    assert({
      given: 'the page files the glob found under guarded roots',
      should: 'cover every guarded root, so an empty scan cannot pass',
      actual: [
        ...new Set(guarded.map(({ route }) => route.split('/')[1])),
      ].sort(),
      expected: ['judge', 'lobby', 'play', 'ranked', 'recordings', 'settings'],
    });
    const requests = await requestsOf(guarded);
    assert({
      given: `the ${guarded.length} page files under the guarded roots, each rendered`,
      should:
        'call requireAccess once with its own root and its own search params (the requirement comes from the guarded-area table)',
      actual: requests,
      expected: guarded.map(({ file, route }) => ({
        file,
        requests: [{ root: route.split('/')[1], ownSearchParams: true }],
      })),
    });
  });

  test('public spectator pages do not demand an account', async () => {
    const publicRoutes = ['/', '/watch', '/leaderboard', '/tournaments'];
    const spectator = pages.filter(({ route }) => publicRoutes.includes(route));
    assert({
      given: 'the public spectator pages, each rendered',
      should: 'not call requireAccess',
      actual: await requestsOf(spectator),
      expected: spectator.map(({ file }) => ({ file, requests: [] })),
    });
  });
});
