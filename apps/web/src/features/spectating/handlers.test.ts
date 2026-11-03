import { refuseCapacity } from '@daisy/db/testing';
import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { silentLogger } from '../../server/test-loggers.test-support';
import {
  audienceLinkCookie,
  audienceLinkHash,
} from '../audience-link/audience-link';
import { limitAnonymousReads } from './anonymous-read-limit';
import { createSpectatorTimelineHandlers } from './handlers';

setupRitewayBun();

const roundId = 'abcdefghijklmnopqrstuvwx';
const request = (headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/rounds/${roundId}/timeline`, { headers });
const handlers = (readSpectatorTimeline: (input: never) => Promise<unknown>) =>
  createSpectatorTimelineHandlers({
    logger: silentLogger,
    reporter: noopErrorReporter,
    clock: { now: () => '2026-11-02T00:00:00.000Z' },
    feedUrlOf: () => null,
    store: { readSpectatorTimeline } as never,
  });

describe('spectator timeline route', () => {
  test('the per-client limit runs before any read', async () => {
    let reads = 0;
    const limited = createSpectatorTimelineHandlers({
      logger: silentLogger,
      reporter: noopErrorReporter,
      clock: { now: () => '2026-11-02T00:00:00.000Z' },
      feedUrlOf: () => null,
      store: {
        readSpectatorTimeline: async () => {
          reads += 1;
          return null;
        },
      } as never,
      limitRead: limitAnonymousReads(() => ({
        consume: async () => ({ allowed: false, retryAfterSeconds: 30 }),
      })),
    });
    const response = await limited.GET(request(), roundId);
    assert({
      given: 'an address past its limit',
      should: 'refuse and read nothing',
      actual: [response.status, reads],
      expected: [429, 0],
    });
  });

  test('a malformed id reads nothing and takes no place in the memo', async () => {
    let reads = 0;
    const response = await handlers(async () => {
      reads += 1;
      return null;
    }).GET(request(), 'not an id');
    assert({
      given: 'an id no Round could have',
      should: 'answer as missing, with no read',
      actual: [response.status, reads],
      expected: [404, 0],
    });
  });

  test('a Round with no audience', async () => {
    const response = await handlers(async () => null).GET(request(), roundId);
    assert({
      given: 'a private or missing Round',
      should: 'answer one uncached not found',
      actual: [response.status, response.headers.get('Cache-Control')],
      expected: [404, 'no-store'],
    });
  });

  test('a read that fails', async () => {
    const response = await handlers(async () => {
      throw new Error('down');
    }).GET(request(), roundId);
    assert({
      given: 'an outage',
      should: 'never let a CDN keep the failure',
      actual: [response.status, response.headers.get('Cache-Control')],
      expected: [500, 'no-store'],
    });
  });

  test('a malformed id reaches no store', async () => {
    let reads = 0;
    const response = await handlers(async () => {
      reads += 1;
      return null;
    }).GET(request(), 'not an id');
    assert({
      given: 'a malformed id',
      should: 'answer not found without a read',
      actual: [response.status, reads],
      expected: [404, 0],
    });
  });

  describe('an unlisted Round', () => {
    const token = 'A'.repeat(43);
    const holding = (value: string) => ({
      cookie: audienceLinkCookie(roundId, value, { secure: false }).split(
        ';',
      )[0]!,
    });
    const timelineRead = (visibility: 'public' | 'unlisted') => ({
      round: {
        id: roundId,
        visibility,
        status: 'active',
        competitionType: 'casual',
        resolution: null,
        rules: { segments: [] },
        outcome: null,
        startedAt: null,
        completedAt: null,
      },
      broadcast: null,
      outcomeReleased: false,
      seats: [],
      segments: [],
      horizonMs: null,
      ballots: [],
      ratings: [],
      captions: [],
      recordingStatus: null,
      recordingLifecycle: null,
      recordingJob: null,
    });
    const unlistedRoute = () => {
      const world = {
        hash: audienceLinkHash(token),
        timelineReads: 0,
        links: 0,
      };
      const route = createSpectatorTimelineHandlers({
        logger: silentLogger,
        reporter: noopErrorReporter,
        clock: { now: () => '2026-11-02T00:00:00.000Z' },
        feedUrlOf: () => null,
        store: {
          readSpectatorTimeline: async () => {
            world.timelineReads += 1;
            return timelineRead('unlisted');
          },
          readRoundAudienceLink: async () => {
            world.links += 1;
            return {
              roomId: 'room',
              visibility: 'unlisted',
              audienceLinkHash: world.hash,
            };
          },
        } as never,
      });
      return { world, route };
    };
    const answer = async (response: Response) => [
      response.status,
      await response.text(),
      response.headers.get('Cache-Control'),
    ];

    test('without its current link it reads exactly as a missing Round', async () => {
      const { route } = unlistedRoute();
      const missing = await answer(
        await handlers(async () => null).GET(request(), roundId),
      );
      assert({
        given: 'no link, then a wrong one',
        should: 'answer byte for byte what a missing Round answers',
        actual: [
          await answer(await route.GET(request(), roundId)),
          await answer(
            await route.GET(request(holding('B'.repeat(43))), roundId),
          ),
        ],
        expected: [missing, missing],
      });
    });

    test('with its link it is read, and never by a shared cache', async () => {
      const { route } = unlistedRoute();
      const response = await route.GET(request(holding(token)), roundId);
      assert({
        given: 'the current link',
        should: 'answer the timeline as no-store',
        actual: [response.status, response.headers.get('Cache-Control')],
        expected: [200, 'no-store'],
      });
    });

    test('replacing the link refuses the old one inside the memo’s interval', async () => {
      const { world, route } = unlistedRoute();
      const before = await route.GET(request(holding(token)), roundId);
      world.hash = audienceLinkHash('C'.repeat(43));
      const after = await route.GET(request(holding(token)), roundId);
      assert({
        given: 'a held snapshot and a link replaced after it was read',
        should:
          'refuse the old link on the very next read, with no new snapshot',
        actual: [before.status, after.status, world.timelineReads],
        expected: [200, 404, 1],
      });
    });

    test('a memoized unlisted snapshot is served to nobody without the link', async () => {
      const { route } = unlistedRoute();
      await route.GET(request(holding(token)), roundId);
      const stranger = await route.GET(request(), roundId);
      assert({
        given: 'a snapshot just read for the link’s holder',
        should: 'refuse the next reader without it',
        actual: stranger.status,
        expected: 404,
      });
    });

    test('a public Round costs a crowd no link read and stays cacheable', async () => {
      let links = 0;
      const route = createSpectatorTimelineHandlers({
        logger: silentLogger,
        reporter: noopErrorReporter,
        clock: { now: () => '2026-11-02T00:00:00.000Z' },
        feedUrlOf: () => null,
        store: {
          readSpectatorTimeline: async () => timelineRead('public'),
          readRoundAudienceLink: async () => {
            links += 1;
            return null;
          },
        } as never,
      });
      const response = await route.GET(request(), roundId);
      assert({
        given: 'a public Round',
        should: 'answer the shared cache rule with no link read',
        actual: [response.status, response.headers.get('Cache-Control'), links],
        expected: [200, PUBLIC_SNAPSHOT_CACHE, 0],
      });
    });
  });

  describe('a crowd on one process', () => {
    const roundOf = (id: string) => ({
      round: {
        id,
        visibility: 'public',
        status: 'active',
        competitionType: 'casual',
        resolution: null,
        rules: { segments: [] },
        outcome: null,
        startedAt: null,
        completedAt: null,
      },
      broadcast: null,
      outcomeReleased: false,
      seats: [],
      segments: [],
      horizonMs: null,
      ballots: [],
      ratings: [],
      captions: [] as { id: string; side: string; text: string }[],
      recordingStatus: null,
      recordingLifecycle: null,
      recordingJob: null,
    });
    const otherRound = 'zyxwvutsrqponmlkjihgfedc';
    const crowd = () => {
      const world = { nowMs: Date.parse('2026-11-02T00:00:00.000Z'), reads: 0 };
      /** A caption whose fact leaves at this instant, by the read's own clock. */
      const releasedAtMs = world.nowMs + 1500;
      const route = createSpectatorTimelineHandlers({
        logger: silentLogger,
        reporter: noopErrorReporter,
        clock: { now: () => new Date(world.nowMs).toISOString() },
        feedUrlOf: () => null,
        store: {
          readSpectatorTimeline: async (input: { roundId: string }) => {
            world.reads += 1;
            const read = roundOf(input.roundId);
            return world.nowMs >= releasedAtMs
              ? {
                  ...read,
                  captions: [
                    { id: 'c', side: 'affirmative', text: 'released line' },
                  ],
                }
              : read;
          },
          readRoundAudienceLink: async () => null,
        } as never,
      });
      const get = async (id: string) =>
        await (
          await route.GET(
            new Request(`http://localhost/api/rounds/${id}/timeline`),
            id,
          )
        ).text();
      return { world, get };
    };

    test('asks inside the interval share one read and its very bytes', async () => {
      const { world, get } = crowd();
      const answers = await Promise.all([get(roundId), get(roundId)]);
      world.nowMs += 999;
      answers.push(await get(roundId));
      assert({
        given: 'three asks inside one second',
        should: 'read once and answer the same body',
        actual: [world.reads, new Set(answers).size],
        expected: [1, 1],
      });
    });

    test('a cached answer never runs ahead of the release rule', async () => {
      const { world, get } = crowd();
      const before = await get(roundId);
      world.nowMs += 1000;
      const stillHeld = await get(roundId);
      world.nowMs += 500;
      const held = await get(roundId);
      world.nowMs += 500;
      const released = await get(roundId);
      assert({
        given: 'a fact leaving between two reads',
        should:
          'answer it only from a read made after it left, and until then the older answer',
        actual: [before, stillHeld, held, released].map((body) =>
          body.includes('released line'),
        ),
        expected: [false, false, false, true],
      });
    });

    test('one Round is never answered with another', async () => {
      const { get } = crowd();
      const [one, other] = await Promise.all([get(roundId), get(otherRound)]);
      assert({
        given: 'two Rounds asked at once',
        should: 'answer each with its own',
        actual: [JSON.parse(one).roundId, JSON.parse(other).roundId],
        expected: [roundId, otherRound],
      });
    });

    test('a full lane refuses for the interval, without retrying or reporting', async () => {
      let reads = 0;
      const captured: unknown[] = [];
      const route = createSpectatorTimelineHandlers({
        logger: silentLogger,
        reporter: {
          capture: (error: unknown) => captured.push(error),
        } as never,
        clock: { now: () => '2026-11-02T00:00:00.000Z' },
        feedUrlOf: () => null,
        store: {
          readSpectatorTimeline: async () => {
            reads += 1;
            throw refuseCapacity({ lane: 'audience', reason: 'saturated' });
          },
        } as never,
      });
      const answers = await Promise.all(
        [0, 1, 2].map(() => route.GET(request(), roundId)),
      );
      assert({
        given: 'three asks while the audience lane is full',
        should:
          'try once, refuse each with a time to come back, report nothing',
        actual: [
          answers.map((response) => response.status),
          answers[0]!.headers.get('Retry-After'),
          answers[0]!.headers.get('Cache-Control'),
          reads,
          captured.length,
        ],
        expected: [[503, 503, 503], '2', 'no-store', 1, 0],
      });
    });

    test('an unlisted crowd joins the link read in flight', async () => {
      const token = 'A'.repeat(43);
      let links = 0;
      let open: (value: unknown) => void = () => undefined;
      const route = createSpectatorTimelineHandlers({
        logger: silentLogger,
        reporter: noopErrorReporter,
        clock: { now: () => '2026-11-02T00:00:00.000Z' },
        feedUrlOf: () => null,
        store: {
          readSpectatorTimeline: async () => ({
            ...roundOf(roundId),
            round: { ...roundOf(roundId).round, visibility: 'unlisted' },
          }),
          readRoundAudienceLink: () => {
            links += 1;
            return new Promise((resolve) => {
              open = resolve;
            });
          },
        } as never,
      });
      const holder = request({
        cookie: audienceLinkCookie(roundId, token, { secure: false }).split(
          ';',
        )[0]!,
      });
      const asks = [
        route.GET(holder.clone(), roundId),
        route.GET(holder.clone(), roundId),
      ];
      await Bun.sleep(0);
      open({
        roomId: 'room',
        visibility: 'unlisted',
        audienceLinkHash: audienceLinkHash(token),
      });
      const answers = await Promise.all(asks);
      assert({
        given: 'two holders of the link asking during one read of it',
        should: 'read it once and admit both',
        actual: [links, answers.map((response) => response.status)],
        expected: [1, [200, 200]],
      });
    });
  });

  test('the cache rule belongs to this answer alone', () => {
    assert({
      given: 'the snapshot cache rule',
      should: 'keep a CDN lifetime of a second, under the polling interval',
      actual: PUBLIC_SNAPSHOT_CACHE,
      expected: 'public, max-age=1, s-maxage=1, stale-while-revalidate=1',
    });
  });
});
