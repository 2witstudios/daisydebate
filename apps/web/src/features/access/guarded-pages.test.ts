import { join } from 'node:path';
import { mock } from 'bun:test';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { guardedAreaFor, isGuardedPath } from './decision';

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
// Public pages that only read who is asking (the watch pages, the
// leaderboard, which pins the viewer's line, and the Tournaments index) get
// an anonymous visitor instead of the request's cookies.
mock.module(join(import.meta.dir, '../../lib/request-session.ts'), () => ({
  requestIdentity: async () => ({ state: 'anonymous' }),
}));
// The settings screen's client component is not under test here; loading it
// would only add code this suite never runs.
mock.module(
  join(import.meta.dir, '../../ui/settings/security/security-page.tsx'),
  () => ({ SecurityPage: () => null }),
);

type Page = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => unknown;

// The pages this suite renders, by file: every guarded page and every public
// spectator page. The tests fail on a page the glob finds but this misses.
// Loaded lazily, after the mocks above, so no page pulls in the real guard.
const rendered: Readonly<Record<string, () => Promise<{ default: unknown }>>> =
  {
    '(shell)/debates/page.tsx': () => import('../../app/(shell)/debates/page'),
    '(shell)/debates/[id]/page.tsx': () =>
      import('../../app/(shell)/debates/[id]/page'),
    '(shell)/rooms/[id]/page.tsx': () =>
      import('../../app/(shell)/rooms/[id]/page'),
    '(shell)/play/room/page.tsx': () =>
      import('../../app/(shell)/play/room/page'),
    '(shell)/notifications/page.tsx': () =>
      import('../../app/(shell)/notifications/page'),
    '(shell)/judge/page.tsx': () => import('../../app/(shell)/judge/page'),
    '(shell)/judge/ballot/[debateId]/page.tsx': () =>
      import('../../app/(shell)/judge/ballot/[debateId]/page'),
    '(shell)/judge/rating/page.tsx': () =>
      import('../../app/(shell)/judge/rating/page'),
    '(shell)/judge/resources/page.tsx': () =>
      import('../../app/(shell)/judge/resources/page'),
    '(shell)/judge/waiting/page.tsx': () =>
      import('../../app/(shell)/judge/waiting/page'),
    '(shell)/lobby/page.tsx': () => import('../../app/(shell)/lobby/page'),
    '(shell)/play/page.tsx': () => import('../../app/(shell)/play/page'),
    '(shell)/ranked/page.tsx': () => import('../../app/(shell)/ranked/page'),
    '(shell)/ranked/host/page.tsx': () =>
      import('../../app/(shell)/ranked/host/page'),
    '(shell)/recordings/page.tsx': () =>
      import('../../app/(shell)/recordings/page'),
    '(shell)/recordings/[debateId]/page.tsx': () =>
      import('../../app/(shell)/recordings/[debateId]/page'),
    '(shell)/prep/page.tsx': () => import('../../app/(shell)/prep/page'),
    '(shell)/prep/cards/new/page.tsx': () =>
      import('../../app/(shell)/prep/cards/new/page'),
    '(shell)/prep/cards/[id]/page.tsx': () =>
      import('../../app/(shell)/prep/cards/[id]/page'),
    '(shell)/prep/cards/[id]/delete/page.tsx': () =>
      import('../../app/(shell)/prep/cards/[id]/delete/page'),
    '(shell)/prep/briefs/[id]/page.tsx': () =>
      import('../../app/(shell)/prep/briefs/[id]/page'),
    '(shell)/prep/briefs/new/page.tsx': () =>
      import('../../app/(shell)/prep/briefs/new/page'),
    '(shell)/prep/cases/[id]/page.tsx': () =>
      import('../../app/(shell)/prep/cases/[id]/page'),
    '(shell)/prep/briefs/[id]/review/page.tsx': () =>
      import('../../app/(shell)/prep/briefs/[id]/review/page'),
    '(shell)/prep/teams/[id]/page.tsx': () =>
      import('../../app/(shell)/prep/teams/[id]/page'),
    '(shell)/prep/privacy/page.tsx': () =>
      import('../../app/(shell)/prep/privacy/page'),
    '(shell)/prep/in-debate/page.tsx': () =>
      import('../../app/(shell)/prep/in-debate/page'),
    '(shell)/prep/start/page.tsx': () =>
      import('../../app/(shell)/prep/start/page'),
    '(shell)/train/page.tsx': () => import('../../app/(shell)/train/page'),
    '(shell)/train/progress/page.tsx': () =>
      import('../../app/(shell)/train/progress/page'),
    '(shell)/train/review/page.tsx': () =>
      import('../../app/(shell)/train/review/page'),
    '(shell)/train/drill/page.tsx': () =>
      import('../../app/(shell)/train/drill/page'),
    '(shell)/train/welcome/page.tsx': () =>
      import('../../app/(shell)/train/welcome/page'),
    '(shell)/train/practice/page.tsx': () =>
      import('../../app/(shell)/train/practice/page'),
    '(shell)/train/practice/live/page.tsx': () =>
      import('../../app/(shell)/train/practice/live/page'),
    '(shell)/train/practice/unavailable/page.tsx': () =>
      import('../../app/(shell)/train/practice/unavailable/page'),
    '(shell)/train/practice/debrief/page.tsx': () =>
      import('../../app/(shell)/train/practice/debrief/page'),
    '(shell)/train/rules/page.tsx': () =>
      import('../../app/(shell)/train/rules/page'),
    '(shell)/settings/page.tsx': () =>
      import('../../app/(shell)/settings/page'),
    '(shell)/settings/security/page.tsx': () =>
      import('../../app/(shell)/settings/security/page'),
    '(shell)/page.tsx': () => import('../../app/(shell)/page'),
    '(shell)/watch/page.tsx': () => import('../../app/(shell)/watch/page'),
    '(shell)/watch/[debateId]/page.tsx': () =>
      import('../../app/(shell)/watch/[debateId]/page'),
    '(shell)/ai-debate/page.tsx': () =>
      import('../../app/(shell)/ai-debate/page'),
    '(bare)/ai-debate/[id]/page.tsx': () =>
      import('../../app/(bare)/ai-debate/[id]/page'),
    '(shell)/leaderboard/page.tsx': () =>
      import('../../app/(shell)/leaderboard/page'),
    '(shell)/tournaments/page.tsx': () =>
      import('../../app/(shell)/tournaments/page'),
    '(shell)/tournaments/enter/[id]/page.tsx': () =>
      import('../../app/(shell)/tournaments/enter/[id]/page'),
    '(shell)/tournaments/enter/[id]/withdraw/page.tsx': () =>
      import('../../app/(shell)/tournaments/enter/[id]/withdraw/page'),
    '(shell)/tournaments/mine/[id]/page.tsx': () =>
      import('../../app/(shell)/tournaments/mine/[id]/page'),
    '(shell)/tournaments/mine/[id]/room/[round]/page.tsx': () =>
      import('../../app/(shell)/tournaments/mine/[id]/room/[round]/page'),
    '(bare)/rooms/[id]/round/page.tsx': () =>
      import('../../app/(bare)/rooms/[id]/round/page'),
    '(bare)/tournaments/mine/[id]/certificate/page.tsx': () =>
      import('../../app/(bare)/tournaments/mine/[id]/certificate/page'),
    '(shell)/tournaments/organize/page.tsx': () =>
      import('../../app/(shell)/tournaments/organize/page'),
    '(shell)/tournaments/organize/new/page.tsx': () =>
      import('../../app/(shell)/tournaments/organize/new/page'),
    '(shell)/tournaments/organize/[id]/page.tsx': () =>
      import('../../app/(shell)/tournaments/organize/[id]/page'),
  };

/** What a page asked the guard when rendered with its own search params. */
const guardRequestsOf = async (file: string) => {
  const load = rendered[file];
  if (!load) return [{ root: 'not rendered by this suite', file }];
  const page = (await load()).default as Page;
  const searchParams = Promise.resolve({ from: 'test' });
  guardCalls.length = 0;
  try {
    await page({
      params: Promise.resolve({ username: 'someone', id: 'x', debateId: 'x' }),
      searchParams,
    });
  } catch (error) {
    // A page may answer 404 for the placeholder id; the guard ran first.
    if (
      !String((error as { digest?: unknown }).digest).startsWith(
        'NEXT_HTTP_ERROR_FALLBACK',
      )
    )
      throw error;
  }
  return guardCalls.map((call) => ({
    root: guardedAreaFor(call.path),
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
        ...new Set(guarded.map(({ route }) => guardedAreaFor(route))),
      ].sort(),
      expected: [
        '/ai-debate',
        '/debates',
        '/judge',
        '/lobby',
        '/notifications',
        '/play',
        '/prep',
        '/ranked',
        '/recordings',
        '/rooms',
        '/settings',
        '/tournaments/enter',
        '/tournaments/mine',
        '/tournaments/organize',
        '/train',
      ],
    });
    const requests = await requestsOf(guarded);
    assert({
      given: `the ${guarded.length} page files under the guarded roots, each rendered`,
      should:
        'call requireAccess once with its own guarded area and its own search params (the requirement comes from the guarded-area table)',
      actual: requests,
      expected: guarded.map(({ file, route }) => ({
        file,
        requests: [{ root: guardedAreaFor(route), ownSearchParams: true }],
      })),
    });
  });

  test('public spectator pages do not demand an account', async () => {
    const publicRoutes = [
      '/',
      '/watch',
      '/watch/[debateId]',
      '/leaderboard',
      '/tournaments',
    ];
    const spectator = pages.filter(({ route }) => publicRoutes.includes(route));
    assert({
      given: 'the public spectator pages, each rendered',
      should: 'not call requireAccess',
      actual: await requestsOf(spectator),
      expected: spectator.map(({ file }) => ({ file, requests: [] })),
    });
  });
});
