import { projectAudienceSnapshot } from '@daisy/debate-engine';
import { refuseCapacity } from '@daisy/db/testing';
import { noopErrorReporter } from '@daisy/observability';
import { audienceSnapshotSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { audienceLinkHash } from '../audience-link/audience-link';
import { VIEWER_BUCKET_MS } from '../viewer-counts/viewer-count';
import {
  audienceFor,
  createAudienceSnapshotRoute,
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

  test('a malformed id has no audience and reaches no store', async () => {
    assert({
      given: 'an id that is not one',
      should: 'answer null',
      actual: await readAudienceSnapshot(
        {
          store: {
            readAudienceSnapshot: () => Promise.reject(new Error('no read')),
          } as never,
        },
        { roundId: 'not an id!' },
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

describe('the live room route', () => {
  const read = {
    visibility: 'public' as const,
    hasBroadcast: true,
    open: true,
    messages: [],
    reactions: [],
  };
  const route = (standing: unknown, actorId: string | null) =>
    createAudienceSnapshotRoute({
      logger: silentLogger,
      reporter: noopErrorReporter,
      store: {
        readAudienceSnapshot: async () => read,
        readRoundAudienceLink: async () => null,
        readLiveRoomStanding: async () => standing,
      } as never,
      identify: async () =>
        (actorId
          ? { principal: { kind: 'user', actorId } }
          : { state: 'anonymous' }) as never,
    });
  const get = (handler: ReturnType<typeof route>) =>
    handler(
      new Request(`http://localhost/api/rounds/${roundId}/audience`),
      roundId,
    );

  test('nobody outside the live room reads it', async () => {
    assert({
      given: 'a visitor, and an account with no place in the room',
      should: 'answer both as missing: a viewer reads the published state',
      actual: [
        (await get(route(null, null))).status,
        (await get(route(null, 'a'.repeat(24)))).status,
      ],
      expected: [404, 404],
    });
  });

  test('someone in the live room reads what their place allows', async () => {
    const response = await get(route({ kind: 'host' }, 'a'.repeat(24)));
    assert({
      given: 'a host with no seat',
      should: 'answer uncached',
      actual: [response.status, response.headers.get('Cache-Control')],
      expected: [200, 'no-store'],
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
