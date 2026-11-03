import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../../server/test-loggers.test-support';
import { CONTENT_WAIVER_VERSION } from '../legal/agreements';
import { createContentWaiverHandler } from './content-waiver-handler';

setupRitewayBun();

const origin = 'https://daisy.test';
const principal = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };

const handler = ({
  state = 'member',
  outcome = 'signed',
  limited = false,
}: {
  readonly state?: string;
  readonly outcome?: 'signed' | 'no-active-season';
  readonly limited?: boolean;
} = {}) => {
  const signed: (readonly [string, string])[] = [];
  const handle = createContentWaiverHandler({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => ({ state, principal }) as never,
    limiter: () =>
      ({
        consume: async () => ({ allowed: !limited, retryAfterSeconds: 1 }),
      }) as never,
    sign: async (userId, version) => {
      signed.push([userId, version]);
      return outcome;
    },
  });
  return { handle, signed };
};

const post = (body: unknown, from = origin) =>
  new Request(`${origin}/api/agreements/content-waiver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: from },
    body: JSON.stringify(body),
  });

const valid = { version: CONTENT_WAIVER_VERSION, accepted: 'yes' };

describe('signing the content waiver', () => {
  test('a member signs the served version', async () => {
    const { handle, signed } = handler();
    const response = await handle(post(valid));
    assert({
      given: 'a member, the served version and a ticked box',
      should: 'record the signature for that account and version',
      actual: [response.status, signed],
      expected: [200, [[principal.userId, CONTENT_WAIVER_VERSION]]],
    });
  });

  test('nothing is signed without the act of the member', async () => {
    const cases = [
      { version: CONTENT_WAIVER_VERSION },
      { version: CONTENT_WAIVER_VERSION, accepted: 'no' },
      { ...valid, userId: 'someone-else' },
    ];
    const results = await Promise.all(
      cases.map(async (body) => {
        const { handle, signed } = handler();
        return [(await handle(post(body))).status, signed.length];
      }),
    );
    assert({
      given: 'an unticked box, a refused box and a claimed account',
      should: 'refuse each and sign nothing',
      actual: results,
      expected: [
        [400, 0],
        [400, 0],
        [400, 0],
      ],
    });
  });

  test('a stale form is told so', async () => {
    const { handle, signed } = handler();
    const response = await handle(post({ ...valid, version: 'draft-0' }));
    assert({
      given: 'a version that is no longer served',
      should: 'refuse with the closed reason and sign nothing',
      actual: [
        response.status,
        ((await response.json()) as { refusal: string }).refusal,
        signed.length,
      ],
      expected: [409, 'content-waiver-changed', 0],
    });
  });

  test('no season is open', async () => {
    const response = await handler({ outcome: 'no-active-season' }).handle(
      post(valid),
    );
    assert({
      given: 'no active season',
      should: 'refuse with the closed reason',
      actual: [
        response.status,
        ((await response.json()) as { refusal: string }).refusal,
      ],
      expected: [409, 'ranked-unavailable'],
    });
  });

  test('the boundary gates', async () => {
    const waitlisted = handler({ state: 'waitlisted' });
    const foreign = handler();
    const limited = handler({ limited: true });
    assert({
      given: 'a waitlisted account, another origin and a spent budget',
      should: 'refuse each and sign nothing',
      actual: [
        (await waitlisted.handle(post(valid))).status,
        (await foreign.handle(post(valid, 'https://elsewhere.test'))).status,
        (await limited.handle(post(valid))).status,
        [...waitlisted.signed, ...foreign.signed, ...limited.signed].length,
      ],
      expected: [403, 403, 429, 0],
    });
  });
});
