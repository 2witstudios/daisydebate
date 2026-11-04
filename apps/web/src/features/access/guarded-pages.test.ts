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
  accessOrTemporary: async (path: string, searchParams: unknown) => {
    guardCalls.push({ path, searchParams });
    return { kind: 'allowed', identity: { state: 'anonymous' } };
  },
}));
// Public pages that only read who is asking (the Watch and Recordings pages
// and the leaderboard, which pins the viewer's line) get
// an anonymous visitor instead of the request's cookies.
mock.module(join(import.meta.dir, '../../lib/request-session.ts'), () => ({
  requestRoomDraftAnswer: async () => ({ values: {} }),
  requestIdentity: async () => ({ state: 'anonymous' }),
  requestLadder: async () => null,
  requestRoundRatings: async () => null,
  requestWatchRound: async () => null,
  requestWatchableRoundOfRoom: async () => null,
  requestPresentedLink: async () => null,
  requestHostedAudienceLink: async () => null,
  requestFollowing: async () => ({ people: [], history: [] }),
  requestHubCounts: async () => ({ live: 0, recordings: 0 }),
  requestLeadingLive: async () => [],
  requestLiveRoundsOf: async () => new Map(),
  requestLiveListing: async () => ({
    featured: null,
    rows: [],
    total: 0,
    nextBefore: null,
  }),
  requestAudience: async () => null,
  requestNotifications: async () => ({ items: [], unread: 0 }),
  requestAudienceSettings: async () => ({
    preferences: { followed_debater_live: true, recording_ready: true },
    history: [],
  }),
  requestDebaterFollow: async () => null,
  readRecordingArchive: async () => ({
    page: { rows: [], nextBefore: null },
    publicCount: 0,
  }),
  readRecordingHistory: async () => ({ kind: 'not-found' }),
  requestMemberStandings: async () => [],
  privateGroupsOffered: () => false,
  // Settings reads the member's own onboarding answers (ISSUE-324); a
  // visitor has none admitted.
  requestOptionalAnswersAdmitted: async () => false,
  requestOnboardingAnswers: async () => null,
  requestAnalytics: async () => ({
    choice: {
      kind: 'known',
      consent: {
        version: 1,
        necessary: 'granted',
        analytics: 'unanswered',
        replay: 'unanswered',
      },
    },
    available: { analytics: false, replay: false },
    capture: null,
  }),
}));
// The settings screen's client component is not under test here; loading it
// would only add code this suite never runs.
mock.module(
  join(import.meta.dir, '../../ui/settings/security/security-page.tsx'),
  () => ({ SecurityPage: () => null }),
);

// Guard coverage renders outside Next's request store; catalog I/O is proved separately.
mock.module(join(import.meta.dir, '../../app/(shell)/play/actions.ts'), () => ({
  roomTemplates: async () => ({ kind: 'found', choices: [] }),
}));

mock.module(
  join(import.meta.dir, '../../app/(shell)/lobby/actions.ts'),
  () => ({
    roomListing: async () => ({ kind: 'found', rooms: [] }),
  }),
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
    '(shell)/rounds/[id]/page.tsx': () =>
      import('../../app/(shell)/rounds/[id]/page'),
    '(shell)/rounds/[id]/audience-link/page.tsx': () =>
      import('../../app/(shell)/rounds/[id]/audience-link/page'),
    '(bare)/rounds/[id]/room/page.tsx': () =>
      import('../../app/(bare)/rounds/[id]/room/page'),
    '(shell)/rooms/[id]/page.tsx': () =>
      import('../../app/(shell)/rooms/[id]/page'),
    '(shell)/rooms/[id]/rematch/page.tsx': () =>
      import('../../app/(shell)/rooms/[id]/rematch/page'),
    '(shell)/play/room/page.tsx': () =>
      import('../../app/(shell)/play/room/page'),
    '(shell)/notifications/page.tsx': () =>
      import('../../app/(shell)/notifications/page'),
    '(shell)/friends/page.tsx': () => import('../../app/(shell)/friends/page'),
    '(shell)/judge/page.tsx': () => import('../../app/(shell)/judge/page'),
    '(shell)/judge/ballot/[roundId]/page.tsx': () =>
      import('../../app/(shell)/judge/ballot/[roundId]/page'),
    '(shell)/judge/waiting/page.tsx': () =>
      import('../../app/(shell)/judge/waiting/page'),
    '(shell)/lobby/page.tsx': () => import('../../app/(shell)/lobby/page'),
    '(shell)/messages/contacts/page.tsx': () =>
      import('../../app/(shell)/messages/contacts/page'),
    '(shell)/messages/new/page.tsx': () =>
      import('../../app/(shell)/messages/new/page'),
    '(shell)/messages/page.tsx': () =>
      import('../../app/(shell)/messages/page'),
    '(shell)/messages/[channelId]/preferences/page.tsx': () =>
      import('../../app/(shell)/messages/[channelId]/preferences/page'),
    '(shell)/messages/[channelId]/reactions/page.tsx': () =>
      import('../../app/(shell)/messages/[channelId]/reactions/page'),
    '(shell)/messages/[channelId]/message/page.tsx': () =>
      import('../../app/(shell)/messages/[channelId]/message/page'),
    '(shell)/messages/[channelId]/attachments/page.tsx': () =>
      import('../../app/(shell)/messages/[channelId]/attachments/page'),
    '(shell)/messages/[channelId]/page.tsx': () =>
      import('../../app/(shell)/messages/[channelId]/page'),
    '(shell)/messages/requests/[channelId]/page.tsx': () =>
      import('../../app/(shell)/messages/requests/[channelId]/page'),
    '(shell)/messages/requests/[channelId]/status/page.tsx': () =>
      import('../../app/(shell)/messages/requests/[channelId]/status/page'),
    '(shell)/messages/retained/[channelId]/page.tsx': () =>
      import('../../app/(shell)/messages/retained/[channelId]/page'),
    '(shell)/messages/groups/[channelId]/manage/page.tsx': () =>
      import('../../app/(shell)/messages/groups/[channelId]/manage/page'),
    '(shell)/messages/groups/invitations/[channelId]/page.tsx': () =>
      import('../../app/(shell)/messages/groups/invitations/[channelId]/page'),
    '(shell)/play/page.tsx': () => import('../../app/(shell)/play/page'),
    '(shell)/ranked/page.tsx': () => import('../../app/(shell)/ranked/page'),
    '(shell)/ranked/host/page.tsx': () =>
      import('../../app/(shell)/ranked/host/page'),
    '(shell)/recordings/page.tsx': () =>
      import('../../app/(shell)/recordings/page'),
    '(shell)/recordings/[roundId]/page.tsx': () =>
      import('../../app/(shell)/recordings/[roundId]/page'),
    '(shell)/train/page.tsx': () => import('../../app/(shell)/train/page'),
    '(shell)/settings/page.tsx': () =>
      import('../../app/(shell)/settings/page'),
    '(shell)/settings/security/page.tsx': () =>
      import('../../app/(shell)/settings/security/page'),
    '(shell)/page.tsx': () => import('../../app/(shell)/page'),
    '(shell)/watch/page.tsx': () => import('../../app/(shell)/watch/page'),
    '(shell)/watch/[roundId]/page.tsx': () =>
      import('../../app/(shell)/watch/[roundId]/page'),
    '(shell)/leaderboard/page.tsx': () =>
      import('../../app/(shell)/leaderboard/page'),
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
      params: Promise.resolve({ username: 'someone', id: 'x', roundId: 'x' }),
      searchParams,
    });
  } catch (error) {
    // A page may answer 404 for the placeholder id, once the guard ran, or
    // redirect a closed destination to its explainer before any guard.
    const digest = String((error as { digest?: unknown }).digest);
    if (
      guardCalls.length === 0 &&
      !digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') &&
      !digest.startsWith('NEXT_REDIRECT')
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

/** Where a page redirected when rendered, or null when it did not. */
const redirectOf = async (file: string): Promise<string | null> => {
  const load = rendered[file];
  if (!load) return `not rendered by this suite: ${file}`;
  const page = (await load()).default as Page;
  try {
    await page({
      params: Promise.resolve({ roundId: 'x' }),
      searchParams: Promise.resolve({}),
    });
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    return digest.startsWith('NEXT_REDIRECT')
      ? (digest.split(';')[2] ?? null)
      : `threw: ${digest}`;
  }
};

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
        '/friends',
        '/judge',
        '/lobby',
        '/messages',
        '/notifications',
        '/play',
        '/ranked',
        '/rooms',
        '/rounds',
        '/settings',
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
      '/watch/[roundId]',
      '/recordings',
      '/recordings/[roundId]',
      '/leaderboard',
    ];
    const spectator = pages.filter(({ route }) => publicRoutes.includes(route));
    assert({
      given: 'the public spectator pages, each rendered',
      should: 'not call requireAccess',
      actual: await requestsOf(spectator),
      expected: spectator.map(({ file }) => ({ file, requests: [] })),
    });
  });

  test('Watch and Recordings open with their launch flag', async () => {
    const files = [
      '(shell)/watch/page.tsx',
      '(shell)/watch/[roundId]/page.tsx',
      '(shell)/recordings/page.tsx',
      '(shell)/recordings/[roundId]/page.tsx',
    ];
    const destinations: Array<string | null> = [];
    for (const file of files) destinations.push(await redirectOf(file));
    assert({
      given: 'every Watch page with Watch launched',
      should: 'answer with its own screen, never the explainer',
      actual: destinations,
      expected: files.map(() => null),
    });
  });
});
