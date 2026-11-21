import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { composeMediaReleaseHandlers } from './handlers';
import { releaseLinkDigest } from './link-token';
import { releaseStopToken } from './stop-token';

setupRitewayBun();

const origin = 'http://localhost';
const token = 'A'.repeat(43);
const member = {
  state: 'member',
  principal: { kind: 'user', userId: 'user-debater', actorId: 'debater' },
};

/** The routes over recording fakes: what each store call was given. */
const build = () => {
  const calls: [string, unknown][] = [];
  const handlers = composeMediaReleaseHandlers({
    boundary: {
      logger: { ...silentLogger, child: () => silentLogger } as never,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => member as never,
      limiter: () =>
        ({
          consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
        }) as never,
    },
    recipientSubkey: () => 'recipient-key',
    stopSubkey: () => 'stop-key',
    nowMs: () => 0,
    store: {
      mediaReleases: {
        sign: async (digest: string, form: unknown) => {
          calls.push(['sign', { digest, form }]);
          return { kind: 'done', requestId: 'r' };
        },
        stopRequests: async (hash: string) => {
          calls.push(['stop', hash]);
        },
      },
    } as never,
  });
  return { handlers, calls };
};

const posting = (path: string, body: unknown) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('the media release routes (ADR 0151)', () => {
  test('a parent signs', async () => {
    const { handlers, calls } = build();
    const form = {
      name: 'E',
      relation: 'parent',
      wordingVersion: '2026-11-v2',
      attests: true,
      paidAds: false,
    };
    const response = await handlers.sign(
      posting('/api/media-releases/sign', { token, form }),
    );
    assert({
      given: 'a sign token in the body',
      should: 'look it up only by its sign digest',
      actual: { status: response.status, calls },
      expected: {
        status: 200,
        calls: [['sign', { digest: releaseLinkDigest('sign', token), form }]],
      },
    });
    const crossSite = await build().handlers.sign(
      new Request(`${origin}/api/media-releases/sign`, {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token, form }),
      }),
    );
    assert({
      given: 'a post from another origin',
      should: 'refuse it',
      actual: crossSite.status,
      expected: 403,
    });
  });

  test('an opt-out', async () => {
    const hash = 'a'.repeat(64);
    const { handlers, calls } = build();
    const response = await handlers.stop(
      posting('/api/media-releases/stop', {
        a: hash,
        t: releaseStopToken('stop-key', hash),
      }),
    );
    const forged = await build().handlers.stop(
      posting('/api/media-releases/stop', { a: hash, t: 'x' }),
    );
    assert({
      given: 'a valid stop link, then a forged one',
      should: 'stop that address, and refuse the forgery',
      actual: { status: response.status, calls, forged: forged.status },
      expected: { status: 200, calls: [['stop', hash]], forged: 404 },
    });
  });
});
