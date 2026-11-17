import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ProfilePhotoStatus } from '@daisy/protocol/public-profile';
import type { App } from '../../server/app';
import { silentLogger } from '../../server/test-loggers.test-support';
import { composePublicProfileRoutes } from './public-profile-routes';
import { CLIENT_ID_HASH_HEADER } from '../auth/abuse/client-ip';

setupRitewayBun();

const photoId = 'p'.repeat(24);
const bytes = new Uint8Array([82, 73, 70, 70]);

/** Just enough app for the image route: one photo, one store, no session. */
const appWith = (
  status: ProfilePhotoStatus | null,
  signedInActor: string | null = null,
  limited: boolean | 'outage' = false,
) => {
  const reads: string[] = [];
  const dbReads: string[] = [];
  const app = {
    clock: { now: () => '2026-11-16T00:00:00.000Z' },
    logger: silentLogger,
    limiter: {
      consume: async () => {
        if (limited === 'outage') throw new Error('redis down');
        return { allowed: !limited, retryAfterSeconds: 17 };
      },
    },
    reporter: { capture: () => undefined },
    profilePhotoObjects: {
      put: async () => undefined,
      read: async (key: string) => {
        reads.push(key);
        return new Uint8Array(bytes);
      },
      removePrefix: async () => undefined,
    },
    imageScanner: null,
    profilePhotoClassifier: null,
    auth: () => ({
      config: { PUBLIC_APP_URL: 'http://daisy.test' },
      readSession: async () =>
        signedInActor === null
          ? null
          : {
              user: {
                id: 'u'.repeat(24),
                emailVerified: true,
                username: 'ada',
              },
              session: { expiresAt: '2100-01-01T00:00:00.000Z' },
            },
      clock: { now: () => '2026-11-16T00:00:00.000Z' },
      logger: silentLogger,
      getActorByUserId: async (userId: string) =>
        signedInActor === null ? null : { id: signedInActor, userId },
      getParticipationByUserId: async () => ({
        betaState: 'approved',
        ageBand: 'adult',
        restricted: false,
      }),
    }),
    database: {
      readProfilePhoto: async (id: string) => {
        dbReads.push(id);
        return status && id === photoId
          ? {
              photoId,
              actorId: 'a'.repeat(24),
              status,
              objectPrefix: `profile-photos/${photoId}`,
              version: 1,
            }
          : null;
      },
    },
  } as unknown as App;
  return { routes: composePublicProfileRoutes(app), reads, dbReads };
};

const get = (
  status: ProfilePhotoStatus | null,
  params: { photoId: string; size: string },
  headers: HeadersInit = {},
  signedInActor: string | null = null,
) => {
  const { routes, reads } = appWith(status, signedInActor);
  return routes
    .image(
      new Request(
        `http://daisy.test/api/profile-photos/${params.photoId}/${params.size}`,
        {
          headers,
        },
      ),
      params,
    )
    .then((response) => ({ response, reads }));
};

test('a published photo is public and cacheable within the bound', async () => {
  const { response, reads } = await get('published', { photoId, size: '128' });
  assert({
    given: 'a published photo at a stored size, read by a visitor',
    should: 'serve its WebP rendition with a one-minute cache and an ETag',
    actual: {
      status: response.status,
      type: response.headers.get('content-type'),
      cache: response.headers.get('cache-control'),
      etag: response.headers.get('etag'),
      reads,
    },
    expected: {
      status: 200,
      type: 'image/webp',
      cache: 'public, max-age=60, must-revalidate',
      etag: `"${photoId}-128-published"`,
      reads: [`profile-photos/${photoId}/128.webp`],
    },
  });
  const revalidated = await get(
    'published',
    { photoId, size: '128' },
    { 'if-none-match': `"${photoId}-128-published"` },
  );
  assert({
    given: 'a revalidation with the current ETag',
    should: 'answer not modified without reading storage',
    actual: [revalidated.response.status, revalidated.reads],
    expected: [304, []],
  });
});

test('nothing else is served to a visitor', async () => {
  const statuses = await Promise.all(
    (
      [
        ['in_review', photoId, '512'],
        ['removed', photoId, '512'],
        ['erased', photoId, '512'],
        [null, photoId, '512'],
        ['published', photoId, '256'],
        ['published', 'not-an-id', '512'],
      ] as const
    ).map(async ([status, id, size]) => {
      const { response, reads } = await get(status, { photoId: id, size });
      return [status, size, response.status, reads.length];
    }),
  );
  assert({
    given:
      'a photo in review, removed, erased, unknown, at an unstored size, and a malformed id',
    should: 'answer not found and never read storage',
    actual: statuses,
    expected: [
      ['in_review', '512', 404, 0],
      ['removed', '512', 404, 0],
      ['erased', '512', 404, 0],
      [null, '512', 404, 0],
      ['published', '256', 404, 0],
      ['published', '512', 404, 0],
    ],
  });
});

test('a photo in review is its owner’s alone, and never cached', async () => {
  const session = { cookie: 'better-auth.session_token=signed' };
  const owner = await get(
    'in_review',
    { photoId, size: '512' },
    session,
    'a'.repeat(24),
  );
  const other = await get(
    'in_review',
    { photoId, size: '512' },
    session,
    'b'.repeat(24),
  );
  assert({
    given: 'the owner and another member reading a photo in review',
    should: 'serve the owner uncached and answer the other not found',
    actual: [
      owner.response.status,
      owner.response.headers.get('cache-control'),
      owner.reads,
      other.response.status,
      other.reads,
    ],
    expected: [
      200,
      'private, no-store',
      [`profile-photos/${photoId}/512.webp`],
      404,
      [],
    ],
  });
});

test('the image budget is spent before any read, and fails open on an outage', async () => {
  const fetch = async (
    limited: boolean | 'outage',
    headers: Record<string, string>,
  ) => {
    const { routes, reads, dbReads } = appWith('published', null, limited);
    const response = await routes.image(
      new Request(`http://daisy.test/api/profile-photos/${photoId}/128`, {
        headers,
      }),
      { photoId, size: '128' },
    );
    return [
      response.status,
      response.headers.get('retry-after'),
      dbReads.length,
      reads.length,
    ];
  };
  const client = { [CLIENT_ID_HASH_HEADER]: 'c'.repeat(64) };
  assert({
    given:
      'a client past its budget, the same revalidating, an unnamed client past the shared bucket, and a limiter outage',
    should:
      'refuse the first three before any database or storage read, with the limiter’s own wait, and serve during the outage',
    actual: [
      await fetch(true, client),
      await fetch(true, {
        ...client,
        'if-none-match': `"${photoId}-128-published"`,
      }),
      await fetch(true, {}),
      await fetch('outage', client),
    ],
    expected: [
      [429, '17', 0, 0],
      [429, '17', 0, 0],
      [429, '17', 0, 0],
      [200, null, 1, 1],
    ],
  });
});
