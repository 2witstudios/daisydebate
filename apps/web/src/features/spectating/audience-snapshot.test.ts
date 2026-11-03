import { noopErrorReporter } from '@daisy/observability';
import { audienceSnapshotSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { audienceLinkHash } from '../audience-link/audience-link';
import { VIEWER_BUCKET_MS } from '../viewer-counts/viewer-count';
import {
  audienceFor,
  createAudienceSnapshotRoute,
  projectAudienceSnapshot,
  readAudienceForViewer,
  readAudienceSnapshot,
} from './audience-snapshot';

setupRitewayBun();

const roundId = createId();
const linkToken = 'k'.repeat(43);
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
  visibility: 'public' as const,
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
  const store = (over: Partial<typeof read> = {}) => ({
    readAudienceSnapshot: async () => ({ ...read, ...over }),
  });

  test('reads the newest whole count, whatever the timeline has reached', async () => {
    const asked: number[] = [];
    const answer = await readAudienceSnapshot(
      {
        store: store() as never,
        counts: {
          readViewerCount: async (_round, bucket) => {
            asked.push(bucket);
            return 9;
          },
        },
      },
      { roundId, now: new Date(VIEWER_BUCKET_MS * 500 + 5).toISOString() },
    );
    assert({
      given: 'a Broadcast on air',
      should: 'read the bucket before now',
      actual: { asked, viewers: answer?.snapshot.viewers },
      expected: { asked: [499], viewers: 9 },
    });
  });

  test('a Broadcast off the air has no count', async () => {
    let reads = 0;
    const answer = await readAudienceSnapshot(
      {
        store: store({ open: false }) as never,
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
      given: 'a completed Broadcast',
      should: 'not ask for a count',
      actual: { reads, viewers: answer?.snapshot.viewers },
      expected: { reads: 0, viewers: null },
    });
  });

  test('losing Redis loses the count alone', async () => {
    const snapshot = await readAudienceSnapshot(
      {
        store: store() as never,
        counts: {
          readViewerCount: () => Promise.reject(new Error('down')),
        },
      },
      { roundId, now: new Date(0).toISOString() },
    );
    assert({
      given: 'a Redis outage',
      should: 'still serve chat, with no count',
      actual: [snapshot?.snapshot.messages.length, snapshot?.snapshot.viewers],
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
  const route = (
    answer: unknown,
    {
      standing = null,
      identified = false,
    }: { readonly standing?: unknown; readonly identified?: boolean } = {},
  ) =>
    createAudienceSnapshotRoute({
      logger: silentLogger,
      reporter: noopErrorReporter,
      store: {
        readAudienceSnapshot: async () => answer,
        readLiveRoomStanding: async () => standing,
        readRoundAudienceLink: async () => ({
          visibility: 'unlisted',
          audienceLinkHash: audienceLinkHash(linkToken),
        }),
      } as never,
      counts: { readViewerCount: async () => 0 },
      clock: { now: () => new Date(0).toISOString() },
      identify: async () =>
        (identified
          ? {
              state: 'member',
              principal: { kind: 'user', userId: 'u', actorId: 'a' },
            }
          : { state: 'anonymous' }) as never,
    });
  const get = (cookie?: string) =>
    new Request('http://local.test/api/rounds/x/audience', {
      ...(cookie ? { headers: { cookie } } : {}),
    });

  test('answers everyone alike, with no cookie, and may be cached', async () => {
    const response = await route(read)(get('session=secret'), roundId);
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
    const response = await route(null)(get(), roundId);
    assert({
      given: 'a private or missing Round',
      should: 'answer one 404',
      actual: [response.status, response.headers.get('Cache-Control')],
      expected: [404, 'no-store'],
    });
  });

  test('an unlisted Round is read by its link and never cached', async () => {
    const unlisted = { ...read, visibility: 'unlisted' as const };
    const missing = await route(unlisted)(get(), roundId);
    const stale = await route(unlisted)(
      get(`daisy_audience_link_${roundId}=${'x'.repeat(43)}`),
      roundId,
    );
    const held = await route(unlisted)(
      get(`daisy_audience_link_${roundId}=${linkToken}`),
      roundId,
    );
    assert({
      given: 'no link, a replaced link and the current link',
      should: 'answer as missing twice, then answer uncached',
      actual: [
        missing.status,
        stale.status,
        held.status,
        held.headers.get('Cache-Control'),
      ],
      expected: [404, 404, 200, 'no-store'],
    });
  });

  test('a seat with no link on an unlisted Round reads what its place allows', async () => {
    const unlisted = { ...read, visibility: 'unlisted' as const };
    const ownRound = {
      kind: 'seat',
      role: 'affirmative',
      competitionType: 'casual',
      roundEnded: false,
      debatersReadChat: false,
    };
    const hidden = await route(unlisted, {
      identified: true,
      standing: ownRound,
    })(get(), roundId);
    const stranger = await route(unlisted, { identified: true })(
      get(),
      roundId,
    );
    assert({
      given: 'a debater the host turned chat off for, and a signed-in stranger',
      should: 'carry no chat to the first, and answer as missing to the second',
      actual: [
        audienceSnapshotSchema.parse(await hidden.json()).messages,
        hidden.headers.get('Cache-Control'),
        stranger.status,
      ],
      expected: [[], 'no-store', 404],
    });
  });
});

describe('readAudienceForViewer', () => {
  const unlisted = { ...read, visibility: 'unlisted' as const };
  const deps = (standing: unknown) => ({
    store: {
      readAudienceSnapshot: async () => unlisted,
      readLiveRoomStanding: async () => standing,
      readRoundAudienceLink: async () => ({
        visibility: 'unlisted',
        audienceLinkHash: audienceLinkHash(linkToken),
      }),
    } as never,
    counts: { readViewerCount: async () => 0 },
  });
  const input = { roundId, now: new Date(0).toISOString() };

  test('an unlisted Round renders for its link or the live room alone', async () => {
    const stranger = await readAudienceForViewer(deps(null), {
      ...input,
      actorId: 'someone',
      presentedHash: null,
    });
    const linked = await readAudienceForViewer(deps(null), {
      ...input,
      actorId: null,
      presentedHash: audienceLinkHash(linkToken),
    });
    const host = await readAudienceForViewer(deps({ kind: 'seatless-host' }), {
      ...input,
      actorId: 'host',
      presentedHash: null,
    });
    assert({
      given: 'a stranger, a link holder and a seatless host',
      should:
        'render nothing for the stranger; the host reads all, is not a seat, and is in the live room',
      actual: {
        stranger,
        linked: [linked?.inLiveRoom, linked?.unlisted],
        host: [host?.shown.chat, host?.seated, host?.inLiveRoom],
      },
      expected: {
        stranger: null,
        linked: [false, true],
        host: [true, false, true],
      },
    });
  });
});
