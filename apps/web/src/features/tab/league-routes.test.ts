import { join } from 'node:path';
import { mock } from 'bun:test';
import type { Identity } from '@daisy/auth';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { accessGuard } from '../access/guard';

setupRitewayBun();

// The shipped guard runs against a scripted session; a missing league is what
// the stored readers answer for a handle nothing claims. lib/access.ts is
// installed as that guard bound to the script, because another suite in this
// process replaces the module with a recording guard that never redirects.
let identity: Identity;
mock.module(join(import.meta.dir, '../access/page-access.ts'), () =>
  accessGuard(async () => identity),
);
const anonymous: Identity = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
};
const member: Identity = {
  state: 'member',
  username: 'ada',
  principal: { kind: 'user', userId: 'u', actorId: 'actor1' },
};
const app = join(import.meta.dir, '../../app');
// Each replacement keeps every export of the module it stands in for: a suite
// that runs later in this process links its pages against the same module.
const scope = await import('../../lib/page-reads');
mock.module(join(import.meta.dir, '../../lib/page-reads.ts'), () => ({
  ...scope,
  requestIdentity: async () => identity,
  requestNow: () => '2027-03-06T08:00:00.000Z',
}));
const flagReads = await import('../flags/page-reads');
mock.module(join(import.meta.dir, '../flags/page-reads.ts'), () => ({
  ...flagReads,
  requestReleaseEnabled: async () => true,
}));
const tabReads = await import('./page-reads');
mock.module(join(import.meta.dir, './page-reads.ts'), () => ({
  ...tabReads,
  requestLeaguePage: async () => null,
  requestStandingLobbyManagement: async () => null,
  requestStandingRoomPage: async () => null,
}));
const flags = await import('../flags/server');
mock.module(join(import.meta.dir, '../flags/server.ts'), () => ({
  ...flags,
  isReleaseEnabled: async () => true,
}));
const people =
  await import('../../app/(host)/host/leagues/[slug]/people/stored-people');
mock.module(
  join(app, '(host)/host/leagues/[slug]/people/stored-people.ts'),
  () => ({ ...people, readStoredPeople: async () => null }),
);

type Page = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

const pages = {
  league: () => import('../../app/(tab)/leagues/[slug]/page'),
  newRoom: () => import('../../app/(tab)/leagues/[slug]/rooms/new/page'),
  host: () => import('../../app/(host)/host/leagues/[slug]/page'),
  hostPeople: () => import('../../app/(host)/host/leagues/[slug]/people/page'),
};

/** How a page answered: a redirect's target, a 404, or what it threw. */
const answerOf = async (
  load: () => Promise<{ default: unknown }>,
  viewer: Identity,
): Promise<string> => {
  identity = viewer;
  const page = (await load()).default as Page;
  try {
    await page({
      params: Promise.resolve({ slug: 'missing' }),
      searchParams: Promise.resolve({}),
    });
    return 'rendered';
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    if (digest.startsWith('NEXT_REDIRECT'))
      return `redirect ${digest.split(';')[2]}`;
    if (digest === 'NEXT_HTTP_ERROR_FALLBACK;404') return 'not found';
    return `threw ${String((error as { code?: unknown }).code ?? error)}`;
  }
};

describe('league routes for a league that does not exist', () => {
  test('a signed-out visitor is sent to sign in', async () => {
    assert({
      given: 'a signed-out visitor to a missing league and its new-room page',
      should: 'redirect to sign-in carrying the page, never an internal error',
      actual: [
        await answerOf(pages.league, anonymous),
        await answerOf(pages.newRoom, anonymous),
      ],
      expected: [
        'redirect /sign-in?next=%2Fleagues%2Fmissing',
        'redirect /sign-in?next=%2Fleagues%2Fmissing%2Frooms%2Fnew',
      ],
    });
  });

  test('a signed-in member finds no page', async () => {
    assert({
      given:
        'a member asking for a missing league, its new room and its host pages',
      should: 'answer not found',
      actual: [
        await answerOf(pages.league, member),
        await answerOf(pages.newRoom, member),
        await answerOf(pages.host, member),
        await answerOf(pages.hostPeople, member),
      ],
      expected: ['not found', 'not found', 'not found', 'not found'],
    });
  });

  test('a signed-out visitor to a host route is sent to sign in', async () => {
    assert({
      given:
        'a signed-out visitor to a missing league host page and its people',
      should: 'redirect to sign-in carrying the page, never an internal error',
      actual: [
        await answerOf(pages.host, anonymous),
        await answerOf(pages.hostPeople, anonymous),
      ],
      expected: [
        'redirect /sign-in?next=%2Fhost%2Fleagues%2Fmissing',
        'redirect /sign-in?next=%2Fhost%2Fleagues%2Fmissing%2Fpeople',
      ],
    });
  });
});
