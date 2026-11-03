import { noopErrorReporter } from '@daisy/observability';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { audienceLinkHash } from '../audience-link/audience-link';
import { createViewerPulseRoute } from './handler';
import {
  latestViewerBucket,
  VIEWER_BUCKET_MS,
  VIEWER_BUCKET_TTL_MS,
} from './viewer-count';

setupRitewayBun();

const origin = 'http://local.test';
const roundId = createId();
const token = createId();
const link = 'k'.repeat(43);
const pulseAt = (headers: Record<string, string> = {}, body?: unknown) =>
  new Request(`${origin}/api/rounds/${roundId}/viewers`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? { version: 1, token }),
  });
const setup = (onAir = true, visibility: 'public' | 'unlisted' = 'public') => {
  const pulses: unknown[] = [];
  const logged: unknown[] = [];
  const keys: string[] = [];
  const logger = {
    ...silentLogger,
    child: () => logger,
    log: (...event: unknown[]) => {
      logged.push(event);
    },
  } as never;
  const route = createViewerPulseRoute({
    logger,
    reporter: noopErrorReporter,
    origin: () => origin,
    limiter: () => ({
      consume: async (key) => {
        keys.push(key);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    }),
    clock: { now: () => new Date(VIEWER_BUCKET_MS * 10 + 5).toISOString() },
    store: {
      readOnAirAudience: async () => (onAir ? { visibility } : null),
      readRoundAudienceLink: async () => ({
        roomId: 'room',
        visibility,
        audienceLinkHash: audienceLinkHash(link),
      }),
    },
    counts: {
      recordViewerPulse: async (pulse) => {
        pulses.push(pulse);
      },
    },
  });
  return { route, pulses, logged, keys };
};

describe('the viewer pulse route', () => {
  test('counts a tab with an expiry and reads no identity', async () => {
    const { route, pulses, logged } = setup();
    const response = await route(
      pulseAt({ cookie: 'session=secret', 'x-daisy-client-ip': '192.0.2.7' }),
    );
    assert({
      given: 'a pulse from a signed-in browser',
      should:
        'add the token to this bucket, with no log line holding the token, cookie or address',
      actual: {
        status: response.status,
        pulses,
        leaked: ['secret', '192.0.2.7', token].some((value) =>
          JSON.stringify(logged).includes(value),
        ),
      },
      expected: {
        status: 204,
        pulses: [{ roundId, bucket: 10, token, ttlMs: VIEWER_BUCKET_TTL_MS }],
        leaked: false,
      },
    });
  });

  test('a Round off the air stores nothing', async () => {
    const { route, pulses } = setup(false);
    const response = await route(pulseAt());
    assert({
      given: 'a pulse for a Round with no open Broadcast',
      should: 'answer the same and store nothing',
      actual: [response.status, pulses],
      expected: [204, []],
    });
  });

  test('an unlisted Round counts only the holder of its link', async () => {
    const stranger = setup(true, 'unlisted');
    const holder = setup(true, 'unlisted');
    const refused = await stranger.route(pulseAt());
    await holder.route(
      pulseAt({ cookie: `daisy_audience_link_${roundId}=${link}` }),
    );
    assert({
      given: 'a pulse with no link, and one with the current link',
      should: 'answer the same and store only the second',
      actual: [refused.status, stranger.pulses, holder.pulses.length],
      expected: [204, [], 1],
    });
  });

  test('another site cannot pulse, nor a pulse carry an account', async () => {
    const { route, pulses } = setup();
    const foreign = await route(pulseAt({ origin: 'http://other.test' }));
    const named = await route(
      pulseAt({}, { version: 1, token, userId: createId() }),
    );
    assert({
      given: 'a foreign origin, and a body naming an account',
      should: 'refuse both and store nothing',
      actual: [foreign.status, named.status, pulses],
      expected: [403, 400, []],
    });
  });
});

describe('latestViewerBucket', () => {
  test('is the newest whole bucket before now', () => {
    assert({
      given: 'a moment inside a bucket',
      should: 'give the one before it, which has finished gathering',
      actual: latestViewerBucket(VIEWER_BUCKET_MS * 100 + 5),
      expected: 99,
    });
  });
});
