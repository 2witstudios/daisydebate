import { join } from 'node:path';
import { mock } from 'bun:test';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
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
mock.module(join(import.meta.dir, './page-access.ts'), () => ({
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
// and the leaderboard, which pins the viewer's line) use this request fixture.
const adultCoach = {
  state: 'member',
  username: 'coach',
  principal: { kind: 'user', userId: 'coach-user', actorId: 'coach-actor' },
} satisfies Identity;
const studentReads: Array<{
  userId: string;
  actorId: string;
  lobbyId?: string;
}> = [];
const openRatingLobby = {
  lobbyId: 'o'.repeat(24),
  lobbyName: 'Open',
  ageRule: 'adults',
} as const;
const youthRatingLobby = {
  lobbyId: 'y'.repeat(24),
  lobbyName: 'Youth',
  ageRule: 'under-18',
} as const;
const ladderReads: Array<{ lobbyId: string; ladder: { division: string } }> =
  [];
let onlyYouthLobby = false;
mock.module(join(import.meta.dir, '../rooms/page-reads.ts'), () => ({
  requestRoomDraftAnswer: async () => ({ values: {} }),
  requestRoomCreateLobbyChoice: async () => null,
}));
mock.module(join(import.meta.dir, '../../lib/page-reads.ts'), () => ({
  requestIdentity: async () =>
    onlyYouthLobby ? adultCoach : { state: 'anonymous' },
  // A stored league's people page words time by the process clock.
  requestNow: () => '2027-03-06T08:00:00.000Z',
  // A Round page's transcript seed is bounded on the process's time.
  renderReadDeadline: () => ({
    signal: new AbortController().signal,
    clear: () => {},
  }),
}));
mock.module(join(import.meta.dir, '../flags/page-reads.ts'), () => ({
  // The event Room pages reach the release reader through their form action.
  requestReleaseEnabled: async () => false,
}));
mock.module(join(import.meta.dir, '../media-releases/page-reads.ts'), () => ({
  requestMediaReleaseSettings: async () => null,
  requestGuardianRelease: async () => null,
}));
mock.module(join(import.meta.dir, '../documents/page-reads.ts'), () => ({
  requestMemberDrive: () => null,
}));
mock.module(join(import.meta.dir, '../leaderboard/page-reads.ts'), () => ({
  requestLadder: async (input: (typeof ladderReads)[number]) => {
    ladderReads.push(input);
    return null;
  },
  requestSeasonGlance: async () => null,
}));
mock.module(join(import.meta.dir, '../ratings/page-reads.ts'), () => ({
  requestOfficialRatingLadders: async () => [openRatingLobby, youthRatingLobby],
  requestRoundRatings: async () => null,
  requestMemberStandings: async () => [],
  requestMemberDivision: async () => null,
}));
mock.module(join(import.meta.dir, '../lobby/page-reads.ts'), () => ({
  requestLandingLobby: async () => ({ id: openRatingLobby.lobbyId }),
  requestCompetitionAgeBand: async () => (onlyYouthLobby ? 'adult' : null),
  requestGuardianLobbyIds: async () => [],
  requestOfficialStandingLobbies: async () =>
    onlyYouthLobby
      ? [{ id: 'youth-lobby', name: 'Youth', ageRule: 'under-18' }]
      : [openRatingLobby, youthRatingLobby].map(
          ({ lobbyId: id, lobbyName: name, ageRule }) => ({
            id,
            name,
            ageRule,
          }),
        ),
}));
mock.module(join(import.meta.dir, '../tab/page-reads.ts'), () => ({
  // A stored league read answers no league for the placeholder slug.
  requestLeaguePage: async () => null,
  requestStandingLobbyManagement: async () => null,
  requestHostedLeagues: async () => [],
  requestStandingRoomPage: async () => null,
}));
mock.module(join(import.meta.dir, '../spectating/page-reads.ts'), () => ({
  requestWatchRound: async () => null,
  requestWatchableRoundOfRoom: async () => null,
  requestAudience: async () => null,
}));
mock.module(join(import.meta.dir, '../audience-link/page-reads.ts'), () => ({
  requestPresentedLink: async () => null,
  requestHostedAudienceLink: async () => null,
}));
mock.module(join(import.meta.dir, '../watch/page-reads.ts'), () => ({
  requestFollowing: async () => ({ people: [], history: [] }),
  requestHubCounts: async () => ({ live: 0, recordings: 0 }),
  requestLeadingLive: async () => [],
  requestLiveRoundsOf: async () => new Map(),
  requestStudentsLive: async (member: (typeof studentReads)[number]) => {
    studentReads.push(member);
    return [];
  },
  requestStudentRoundIds: async () => [],
  requestLiveListing: async () => ({
    featured: null,
    rows: [],
    total: 0,
    nextBefore: null,
  }),
  requestDebaterFollow: async () => null,
}));
mock.module(join(import.meta.dir, '../notifications/page-reads.ts'), () => ({
  requestNotifications: async () => ({ items: [], unread: 0 }),
  requestAudienceSettings: async () => ({
    preferences: { followed_debater_live: true, recording_ready: true },
    history: [],
    messageRequestSetting: { setting: 'everyone', locked: false },
  }),
}));
mock.module(join(import.meta.dir, '../recording/page-reads.ts'), () => ({
  readRecordingArchive: async () => ({
    page: { rows: [], nextBefore: null },
    publicCount: 0,
  }),
  readRecordingHistory: async () => ({ kind: 'not-found' }),
}));
mock.module(join(import.meta.dir, '../messaging/page-reads.ts'), () => ({
  privateGroupsOffered: () => false,
  messagingLatestPageItems: () => 50,
}));
mock.module(join(import.meta.dir, '../onboarding/page-reads.ts'), () => ({
  // Settings reads the member's own onboarding answers (ISSUE-324); a
  // visitor has none admitted.
  requestOptionalAnswersAdmitted: async () => false,
  requestOnboardingAnswers: async () => null,
}));
mock.module(
  join(import.meta.dir, '../parental-controls/page-reads.ts'),
  () => ({
    requestFamilyViewer: async () => null,
    requestFamilyRows: async () => null,
    requestFriendApprovals: async () => [],
    requestFamilyLobbyPermissions: async () => null,
  }),
);
mock.module(join(import.meta.dir, '../analytics/page-reads.ts'), () => ({
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
    postRoundCall: false,
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
    hostedRoomsRead: async () => [],
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
    '(shell)/rounds/[id]/floor/page.tsx': () =>
      import('../../app/(shell)/rounds/[id]/floor/page'),
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
    '(tab)/leagues/[slug]/page.tsx': () =>
      import('../../app/(tab)/leagues/[slug]/page'),
    '(tab)/leagues/[slug]/rooms/new/page.tsx': () =>
      import('../../app/(tab)/leagues/[slug]/rooms/new/page'),
    '(host)/host/leagues/[slug]/page.tsx': () =>
      import('../../app/(host)/host/leagues/[slug]/page'),
    '(host)/host/leagues/[slug]/people/page.tsx': () =>
      import('../../app/(host)/host/leagues/[slug]/people/page'),
    '(tab)/tournaments/directory/page.tsx': () =>
      import('../../app/(tab)/tournaments/directory/page'),
    '(tab)/rooms/event/[room]/page.tsx': () =>
      import('../../app/(tab)/rooms/event/[room]/page'),
    '(tab)/rooms/event/[room]/ballot/page.tsx': () =>
      import('../../app/(tab)/rooms/event/[room]/ballot/page'),
    '(tab-live)/rooms/event/[room]/live/page.tsx': () =>
      import('../../app/(tab-live)/rooms/event/[room]/live/page'),
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
    '(shell)/clubs/new/page.tsx': () =>
      import('../../app/(shell)/clubs/new/page'),
    '(shell)/clubs/[club]/seats/page.tsx': () =>
      import('../../app/(shell)/clubs/[club]/seats/page'),
    '(shell)/clubs/[club]/releases/page.tsx': () =>
      import('../../app/(shell)/clubs/[club]/releases/page'),
    '(shell)/clubs/[club]/youth/page.tsx': () =>
      import('../../app/(shell)/clubs/[club]/youth/page'),
    '(shell)/clubs/[club]/billing/page.tsx': () =>
      import('../../app/(shell)/clubs/[club]/billing/page'),
    '(shell)/clubs/invitations/[invitation]/page.tsx': () =>
      import('../../app/(shell)/clubs/invitations/[invitation]/page'),
    '(shell)/play/page.tsx': () => import('../../app/(shell)/play/page'),
    '(shell)/ranked/page.tsx': () => import('../../app/(shell)/ranked/page'),
    '(shell)/ranked/host/page.tsx': () =>
      import('../../app/(shell)/ranked/host/page'),
    '(shell)/recordings/page.tsx': () =>
      import('../../app/(shell)/recordings/page'),
    '(shell)/recordings/[roundId]/page.tsx': () =>
      import('../../app/(shell)/recordings/[roundId]/page'),
    '(shell)/prep/page.tsx': () => import('../../app/(shell)/prep/page'),
    '(shell)/train/page.tsx': () => import('../../app/(shell)/train/page'),
    '(shell)/settings/page.tsx': () =>
      import('../../app/(shell)/settings/page'),
    '(shell)/settings/billing/page.tsx': () =>
      import('../../app/(shell)/settings/billing/page'),
    '(shell)/settings/security/page.tsx': () =>
      import('../../app/(shell)/settings/security/page'),
    '(shell)/settings/parental-controls/page.tsx': () =>
      import('../../app/(shell)/settings/parental-controls/page'),
    '(shell)/settings/parental-controls/[linkId]/page.tsx': () =>
      import('../../app/(shell)/settings/parental-controls/[linkId]/page'),
    '(shell)/settings/your-parents/page.tsx': () =>
      import('../../app/(shell)/settings/your-parents/page'),
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
      params: Promise.resolve({
        username: 'someone',
        linkId: 'x',
        id: 'x',
        roundId: 'x',
        slug: 'x',
      }),
      searchParams,
    });
  } catch (error) {
    // A page may answer 404 for the placeholder id, once the guard ran, or
    // redirect before any guard.
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
        '/clubs',
        '/friends',
        '/host/leagues',
        '/judge',
        '/leagues',
        '/lobby',
        '/messages',
        '/notifications',
        '/play',
        '/prep',
        '/ranked',
        '/rooms',
        '/rounds',
        '/settings',
        '/tournaments/directory',
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

  test('a signed-out leaderboard reads only the requested official lobby', async () => {
    const { default: page } =
      await import('../../app/(shell)/leaderboard/page');
    ladderReads.length = 0;
    guardCalls.length = 0;
    await page({
      searchParams: Promise.resolve({ lobby: youthRatingLobby.lobbyId }),
    });
    await page({ searchParams: Promise.resolve({ lobby: 'p'.repeat(24) }) });
    assert({
      given:
        'a signed-out visitor who selects Youth and then supplies an unknown lobby ID',
      should: 'read just the public Youth ladder without requiring a session',
      actual: [
        ladderReads.map(({ lobbyId, ladder }) => [lobbyId, ladder.division]),
        guardCalls.length,
      ],
      expected: [[[youthRatingLobby.lobbyId, 'youth']], 0],
    });
  });

  test('Watch asks for a coach’s student Rounds with no eligible standing lobby', async () => {
    onlyYouthLobby = true;
    try {
      const { default: watchPage } =
        await import('../../app/(shell)/watch/page');
      await watchPage({ searchParams: Promise.resolve({}) });
    } finally {
      onlyYouthLobby = false;
    }
    assert({
      given: 'an adult visits bare /watch and the only official lobby is Youth',
      should: 'read their student Rounds with no standing lobby selected',
      actual: studentReads.splice(0),
      expected: [
        {
          userId: adultCoach.principal.userId,
          actorId: adultCoach.principal.actorId,
          lobbyId: '',
        },
      ],
    });
  });

  test('Watch and Recordings answer with their own screens', async () => {
    const files = [
      '(shell)/watch/page.tsx',
      '(shell)/watch/[roundId]/page.tsx',
      '(shell)/recordings/page.tsx',
      '(shell)/recordings/[roundId]/page.tsx',
    ];
    const destinations: Array<string | null> = [];
    for (const file of files) destinations.push(await redirectOf(file));
    assert({
      given: 'every Watch page',
      should: 'answer with its own screen, never a redirect',
      actual: destinations,
      expected: files.map(() => null),
    });
  });
});
