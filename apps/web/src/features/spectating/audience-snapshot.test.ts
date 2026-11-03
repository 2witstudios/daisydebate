import { noopErrorReporter } from '@daisy/observability';
import { audienceSnapshotSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { VIEWER_BUCKET_MS } from '../viewer-counts/viewer-count';
import {
  audienceFor,
  createAudienceSnapshotRoute,
  projectAudienceSnapshot,
  readAudienceSnapshot,
} from './audience-snapshot';

setupRitewayBun();

const roundId = createId();
const message = {
  id: createId(),
  sequence: 1,
  at: '2026-11-02T12:00:00.000Z',
  author: 'someone',
  text: 'A line',
};
const read = {
  hasBroadcast: true,
  open: true,
  horizonMs: VIEWER_BUCKET_MS * 100,
  messages: [message],
  reactions: [{ kind: 'sharp_point', count: 3 }],
};

describe('projectAudienceSnapshot', () => {
  test('every kind appears, and the state follows the Broadcast', () => {
    const snapshot = projectAudienceSnapshot(roundId, read, 12);
    assert({
      given: 'released rows and a count',
      should: 'pass the schema, with a zero for an unused kind',
      actual: {
        valid: audienceSnapshotSchema.safeParse(snapshot).success,
        reactions: snapshot.reactions.map((row) => row.count),
        states: [
          snapshot.interaction,
          projectAudienceSnapshot(roundId, { ...read, open: false }, 0)
            .interaction,
          projectAudienceSnapshot(
            roundId,
            { ...read, open: false, hasBroadcast: false },
            0,
          ).interaction,
        ],
        noCount: projectAudienceSnapshot(roundId, read, 0).viewers,
      },
      expected: {
        valid: true,
        reactions: [3, 0, 0, 0],
        states: ['open', 'closed', 'unavailable'],
        noCount: null,
      },
    });
  });
});

describe('readAudienceSnapshot', () => {
  const store = (horizonMs: number | null) => ({
    readAudienceSnapshot: async () => ({ ...read, horizonMs }),
  });

  test('reads the count at the timeline, never now', async () => {
    const asked: number[] = [];
    const snapshot = await readAudienceSnapshot(
      {
        store: store(VIEWER_BUCKET_MS * 100 + 20_000) as never,
        counts: {
          readViewerCount: async (_round, bucket) => {
            asked.push(bucket);
            return 9;
          },
        },
      },
      { roundId, now: new Date(VIEWER_BUCKET_MS * 500).toISOString() },
    );
    assert({
      given: 'a clock far ahead of the timeline',
      should: 'read a bucket the timeline has wholly passed',
      actual: { asked, viewers: snapshot?.viewers },
      expected: { asked: [99], viewers: 9 },
    });
  });

  test('a timeline that has not started reads no count', async () => {
    let reads = 0;
    const snapshot = await readAudienceSnapshot(
      {
        store: store(null) as never,
        counts: {
          readViewerCount: async () => {
            reads += 1;
            return 9;
          },
        },
      },
      { roundId, now: new Date(0).toISOString() },
    );
    assert({
      given: 'no released media',
      should: 'not ask for a count',
      actual: { reads, viewers: snapshot?.viewers },
      expected: { reads: 0, viewers: null },
    });
  });

  test('losing Redis loses the count alone', async () => {
    const snapshot = await readAudienceSnapshot(
      {
        store: store(VIEWER_BUCKET_MS * 100) as never,
        counts: {
          readViewerCount: () => Promise.reject(new Error('down')),
        },
      },
      { roundId, now: new Date(0).toISOString() },
    );
    assert({
      given: 'a Redis outage',
      should: 'still serve chat, with no count',
      actual: [snapshot?.messages.length, snapshot?.viewers],
      expected: [1, null],
    });
  });

  test('a malformed id has no audience and reaches no store', async () => {
    assert({
      given: 'an id that is not one',
      should: 'answer null',
      actual: await readAudienceSnapshot(
        {
          store: {
            readAudienceSnapshot: () => Promise.reject(new Error('no read')),
          } as never,
          counts: { readViewerCount: async () => 0 },
        },
        { roundId: 'not an id!', now: new Date(0).toISOString() },
      ),
      expected: null,
    });
  });
});

describe('audienceFor', () => {
  test('takes out what a reader may not see', () => {
    const snapshot = projectAudienceSnapshot(roundId, read, 12);
    const hidden = audienceFor(snapshot, {
      chat: false,
      reactions: false,
      viewers: false,
    });
    assert({
      given: 'a seat shown nothing',
      should: 'carry no message, total or count to the browser',
      actual: [hidden.messages, hidden.reactions, hidden.viewers],
      expected: [[], [], null],
    });
  });
});

describe('the snapshot route', () => {
  const route = (answer: unknown) =>
    createAudienceSnapshotRoute({
      logger: silentLogger,
      reporter: noopErrorReporter,
      store: { readAudienceSnapshot: async () => answer } as never,
      counts: { readViewerCount: async () => 0 },
      clock: { now: () => new Date(0).toISOString() },
    });

  test('answers everyone alike, with no cookie, and may be cached', async () => {
    const response = await route(read)(
      new Request('http://local.test/api/rounds/x/audience', {
        headers: { cookie: 'session=secret' },
      }),
      roundId,
    );
    assert({
      given: 'a request carrying a session cookie',
      should: 'answer cacheably and set no cookie',
      actual: [
        response.status,
        response.headers.get('Cache-Control'),
        response.headers.get('Set-Cookie'),
      ],
      expected: [200, PUBLIC_SNAPSHOT_CACHE, null],
    });
  });

  test('a Round with no audience is not cached', async () => {
    const response = await route(null)(
      new Request('http://local.test/api/rounds/x/audience'),
      roundId,
    );
    assert({
      given: 'a private or missing Round',
      should: 'answer one 404',
      actual: [response.status, response.headers.get('Cache-Control')],
      expected: [404, 'no-store'],
    });
  });
});
