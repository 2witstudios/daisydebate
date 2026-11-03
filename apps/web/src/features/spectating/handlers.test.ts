import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PUBLIC_SNAPSHOT_CACHE } from '../../server/http';
import { silentLogger } from '../../server/test-loggers.test-support';
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

  test('the cache rule belongs to this answer alone', () => {
    assert({
      given: 'the snapshot cache rule',
      should: 'keep a CDN lifetime of a second, under the polling interval',
      actual: PUBLIC_SNAPSHOT_CACHE,
      expected: 'public, max-age=1, s-maxage=1, stale-while-revalidate=1',
    });
  });
});
