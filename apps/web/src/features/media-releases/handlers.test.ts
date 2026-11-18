import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { composeMediaReleaseHandlers } from './handlers';
import { releaseLinkDigest } from './link-token';
import { releaseStopToken } from './stop-token';

setupRitewayBun();

const origin = 'http://localhost';
const roundId = 'abcdefghijklmnopqrstuvwx';
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
      youthRoundPublications: {
        publishYouthRound: async (command: unknown) => {
          calls.push(['publish', command]);
          return { kind: 'published' };
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
const open = async () => true;
const closed = async () => false;

describe('the media release routes (ADR 0151)', () => {
  test('Share publicly', async () => {
    const { handlers, calls } = build();
    const response = await handlers.publish(open)(
      posting('/api/media-releases/publish', { roundId }),
    );
    assert({
      given: 'a debater posting the Round to share, publishing open',
      should: 'publish it as that debater, with the flag already checked',
      actual: { status: response.status, body: await response.json(), calls },
      expected: {
        status: 200,
        body: { kind: 'published' },
        calls: [['publish', { roundId, userId: 'user-debater', open: true }]],
      },
    });
    const missing = await build().handlers.publish(open)(
      posting('/api/media-releases/publish', {}),
    );
    assert({
      given: 'no Round in the body',
      should: 'refuse it as invalid',
      actual: missing.status,
      expected: 400,
    });
    const shut = build();
    const refused = await shut.handlers.publish(closed)(
      posting('/api/media-releases/publish', { roundId }),
    );
    assert({
      given: 'publishing closed',
      should: 'answer not found and publish nothing',
      actual: { status: refused.status, calls: shut.calls },
      expected: { status: 404, calls: [] },
    });
  });

  test('a parent signs', async () => {
    const { handlers, calls } = build();
    const form = {
      name: 'E',
      relation: 'parent',
      attests: true,
      paidAds: false,
    };
    const response = await handlers.sign(open)(
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
    const crossSite = await build().handlers.sign(open)(
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
    const response = await handlers.stop(closed)(
      posting('/api/media-releases/stop', {
        a: hash,
        t: releaseStopToken('stop-key', hash),
      }),
    );
    const forged = await build().handlers.stop(closed)(
      posting('/api/media-releases/stop', { a: hash, t: 'x' }),
    );
    assert({
      given: 'a valid stop link with publishing closed, then a forged one',
      should: 'stop that address anyway, and refuse the forgery',
      actual: { status: response.status, calls, forged: forged.status },
      expected: { status: 200, calls: [['stop', hash]], forged: 404 },
    });
  });
});
