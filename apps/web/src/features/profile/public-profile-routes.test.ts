import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import type { OwnPublicProfile } from '@daisy/db';
import type { App } from '../../server/app';
import { silentLogger } from '../../server/test-loggers.test-support';
import { composePublicProfileRoutes } from './public-profile-routes';

setupRitewayBun();

const origin = 'http://daisy.test';
const userId = 'u'.repeat(24);
const actorId = 'a'.repeat(24);
const cookie = 'better-auth.session_token=signed';

type World = {
  /** The member's account as the fence reads it; `restricted` withdraws access. */
  readonly restricted?: boolean;
  /** The limiter's answer for each bucket prefix; allowed unless named. */
  readonly limited?: readonly string[];
  readonly storage?: boolean;
};

/** A fake app: a real session path, the real fences, recording every call. */
function appFor(world: World = {}) {
  const calls: string[] = [];
  const spent: string[] = [];
  const account: AccountAuthorizationFact = {
    userId,
    actorId,
    member: true,
    erased: false,
    revision: 1,
    beta: { state: 'approved', revision: 1 },
    ageBand: 'adult',
    restricted: world.restricted ?? false,
  } as AccountAuthorizationFact;
  /** The member's text as the database holds it. */
  const stored = { displayName: 'Ada', bio: 'Policy' };
  const empty: OwnPublicProfile = {
    profileId: null,
    displayName: null,
    bio: null,
    published: null,
    inReview: null,
  };
  type Fence = (input: {
    tx: unknown;
    scope: { actorId: string };
    account: AccountAuthorizationFact;
  }) => Promise<void>;
  const fenced =
    (name: string, answer: (input: never) => OwnPublicProfile) =>
    async (scope: { actorId: string }, ...rest: unknown[]) => {
      const fence = rest.at(-1) as Fence;
      await fence({ tx: null, scope, account });
      calls.push(name);
      return answer(rest[0] as never);
    };
  const app = {
    logger: silentLogger,
    reporter: { capture: () => undefined },
    clock: { now: () => '2026-11-16T00:00:00.000Z' },
    ids: { next: () => 'p'.repeat(24) },
    limiter: {
      consume: async (key: string) => {
        spent.push(key.split(':')[0]!);
        const limited = (world.limited ?? []).some((prefix) =>
          key.startsWith(prefix),
        );
        return { allowed: !limited, retryAfterSeconds: 60 };
      },
    },
    profilePhotoObjects: world.storage
      ? {
          put: async () => undefined,
          read: async () => new Uint8Array(),
          removePrefix: async () => undefined,
        }
      : null,
    imageScanner: world.storage ? { scan: async () => 'clean' as const } : null,
    profilePhotoClassifier: null,
    auth: () => ({
      config: { PUBLIC_APP_URL: origin },
      readSession: async () => ({
        user: { id: userId, emailVerified: true, username: 'ada' },
        session: { expiresAt: '2100-01-01T00:00:00.000Z' },
      }),
      clock: { now: () => '2026-11-16T00:00:00.000Z' },
      logger: silentLogger,
      getActorByUserId: async () => ({ id: actorId, userId }),
      getParticipationByUserId: async () => ({
        betaState: 'approved',
        ageBand: 'adult',
        restricted: world.restricted ?? false,
      }),
    }),
    database: {
      readOwnPublicProfile: fenced('readOwn', () => ({ ...empty, ...stored })),
      writePublicProfileText: async (
        scope: { actorId: string },
        input: { displayName: string | null; bio: string | null },
        fenceFor: (current: {
          displayName: string | null;
          bio: string | null;
        }) => Fence,
      ) => {
        // The fence is chosen from the text as the write's transaction reads it.
        await fenceFor(stored)({ tx: null, scope, account });
        calls.push('writeText');
        return {
          ...empty,
          profileId: 'p'.repeat(24),
          displayName: input.displayName,
          bio: input.bio,
        };
      },
      withdrawProfilePhotos: fenced('withdraw', () => empty),
      recordProfilePhoto: fenced('record', () => empty),
    },
  } as unknown as App;
  return { routes: composePublicProfileRoutes(app), calls, spent };
}

const request = (
  method: string,
  path: string,
  init: { body?: BodyInit; type?: string; from?: string } = {},
) =>
  new Request(`${origin}${path}`, {
    method,
    headers: {
      cookie,
      origin: init.from ?? origin,
      ...(init.type ? { 'content-type': init.type } : {}),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });

const edit = (displayName: string, bio = '') =>
  request('PUT', '/api/profile', {
    type: 'application/json',
    body: JSON.stringify({ version: 1, displayName, bio }),
  });

const answer = async (response: Response) => ({
  status: response.status,
  refusal: (
    (await response.json().catch(() => null)) as {
      refusal?: string;
    } | null
  )?.refusal,
});

test('text: a member sets it; a restricted member may only clear it', async () => {
  const member = appFor();
  const set = await member.routes.write(edit('Ada', 'Policy'));
  const restricted = appFor({ restricted: true });
  const refused = await restricted.routes.write(edit('Ada L'));
  const cleared = await restricted.routes.write(edit('', ''));
  const clearedBio = await restricted.routes.write(edit('Ada', ''));
  assert({
    given:
      'an admitted member setting text, and a restricted one setting then clearing',
    should:
      'save the first, refuse a new name under restriction, and allow clearing both or only the bio (ADR 0075)',
    actual: {
      set: set.status,
      refused: refused.status,
      cleared: cleared.status,
      clearedBio: clearedBio.status,
      writes: [member.calls, restricted.calls],
    },
    expected: {
      set: 200,
      refused: 403,
      cleared: 200,
      clearedBio: 200,
      writes: [['writeText'], ['writeText', 'writeText']],
    },
  });
});

test('text: refusals answer their closed word and spend the budget first', async () => {
  const { routes, calls, spent } = appFor();
  const answers = [
    await answer(await routes.write(edit('@alice'))),
    await answer(await routes.write(edit('a'.repeat(41)))),
    await answer(await routes.write(edit('Ada', 'b'.repeat(161)))),
  ];
  const limited = appFor({ limited: ['public-profile'] });
  assert({
    given:
      'an @ handle, an overlong name, an overlong bio, and an exhausted budget',
    should:
      'answer each word with 400, never write, and refuse the budget with 429',
    actual: {
      answers,
      calls,
      spent,
      limited: (await limited.routes.write(edit('Ada'))).status,
      limitedCalls: limited.calls,
    },
    expected: {
      answers: [
        { status: 400, refusal: 'display-name-handle' },
        { status: 400, refusal: 'display-name-too-long' },
        { status: 400, refusal: 'bio-too-long' },
      ],
      calls: [],
      spent: ['public-profile', 'public-profile', 'public-profile'],
      limited: 429,
      limitedCalls: [],
    },
  });
});

test('photo upload: every gate holds before the body is read', async () => {
  const png = () => new Blob([new Uint8Array([1, 2, 3])]);
  const upload = (from?: string) =>
    request('POST', '/api/profile/photo', {
      type: 'image/png',
      body: png(),
      ...(from ? { from } : {}),
    });
  const cross = appFor({ storage: true });
  const unavailable = appFor();
  const limited = appFor({ storage: true, limited: ['profile-photo'] });
  const restricted = appFor({ storage: true, restricted: true });
  const oversize = appFor({ storage: true });
  assert({
    given:
      'a cross-origin upload, no storage, an exhausted budget, a restricted member and a 6 MB body',
    should: 'refuse each before intake, naming the words a member can act on',
    actual: [
      (await cross.routes.uploadPhoto(upload('http://evil.test'))).status,
      await answer(await unavailable.routes.uploadPhoto(upload())),
      (await limited.routes.uploadPhoto(upload())).status,
      (await restricted.routes.uploadPhoto(upload())).status,
      await answer(
        await oversize.routes.uploadPhoto(
          request('POST', '/api/profile/photo', {
            type: 'image/png',
            body: new Blob([new Uint8Array(6 * 1024 * 1024)]),
          }),
        ),
      ),
      [cross.calls, unavailable.calls, limited.calls, restricted.calls],
    ],
    expected: [
      403,
      { status: 503, refusal: 'photo-unavailable' },
      429,
      403,
      { status: 413, refusal: 'photo-too-large' },
      [[], [], [], []],
    ],
  });
});

test('photo removal is a withdrawal a restricted member keeps', async () => {
  const restricted = appFor({ restricted: true });
  const response = await restricted.routes.withdrawPhoto(
    request('DELETE', '/api/profile/photo'),
  );
  assert({
    given: 'a restricted member clearing their photo',
    should: 'withdraw it under the withdrawal capability, spending its budget',
    actual: [response.status, restricted.calls, restricted.spent],
    expected: [200, ['withdraw'], ['profile-photo-withdraw']],
  });
});
