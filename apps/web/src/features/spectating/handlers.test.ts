import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { silentLogger } from '../../server/test-loggers.test-support';
import {
  audienceLinkCookie,
  audienceLinkHash,
} from '../audience-link/audience-link';
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

  test('the cache rule belongs to this answer alone', () => {
    assert({
      given: 'the snapshot cache rule',
      should: 'keep a CDN lifetime of a second, under the polling interval',
      actual: PUBLIC_SNAPSHOT_CACHE,
      expected: 'public, max-age=1, s-maxage=1, stale-while-revalidate=1',
    });
  });
});
