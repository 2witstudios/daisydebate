import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ProfilePhotoStatus } from '@daisy/protocol/public-profile';
import type { App } from '../../server/app';
import { silentLogger } from '../../server/test-loggers.test-support';
import { composePublicProfileRoutes } from './public-profile-routes';

setupRitewayBun();

const photoId = 'p'.repeat(24);
const bytes = new Uint8Array([82, 73, 70, 70]);

/** Just enough app for the image route: one photo, one store, no session. */
const appWith = (status: ProfilePhotoStatus | null) => {
  const reads: string[] = [];
  const app = {
    logger: silentLogger,
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
      readSession: async () => null,
      clock: { now: () => '2026-11-16T00:00:00.000Z' },
      logger: silentLogger,
      getActorByUserId: async () => null,
      getParticipationByUserId: async () => null,
    }),
    database: {
      readProfilePhoto: async (id: string) =>
        status && id === photoId
          ? {
              photoId,
              actorId: 'a'.repeat(24),
              status,
              objectPrefix: `profile-photos/${photoId}`,
              version: 1,
            }
          : null,
    },
  } as unknown as App;
  return { routes: composePublicProfileRoutes(app), reads };
};

const get = (
  status: ProfilePhotoStatus | null,
  params: { photoId: string; size: string },
  headers: HeadersInit = {},
) => {
  const { routes, reads } = appWith(status);
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
