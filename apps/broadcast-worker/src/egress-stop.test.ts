import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createEgressStopper } from './egress-stop';

setupRitewayBun();

const stopper = (status: number, seen: unknown[] = []) =>
  createEgressStopper({
    url: 'wss://livekit.test/',
    token: 'TOKEN',
    fetch: async (url, init) => {
      seen.push([url, init]);
      return { ok: status >= 200 && status < 300, status };
    },
  });

describe('createEgressStopper', () => {
  test('asks LiveKit to stop that Egress under the token alone', async () => {
    const seen: unknown[] = [];
    await stopper(200, seen)('EG_1');
    assert({
      given: 'an Egress id',
      should: 'post to the Egress service with the bearer token',
      actual: seen,
      expected: [
        [
          'https://livekit.test/twirp/livekit.Egress/StopEgress',
          {
            method: 'POST',
            headers: {
              authorization: 'Bearer TOKEN',
              'content-type': 'application/json',
            },
            body: '{"egressId":"EG_1"}',
          },
        ],
      ],
    });
  });
  test('an Egress already gone is stopped', async () => {
    assert({
      given: 'LiveKit answering not found, then failed precondition',
      should: 'resolve both',
      actual: [await stopper(404)('EG'), await stopper(412)('EG')],
      expected: [undefined, undefined],
    });
  });
  test('anything else throws', async () => {
    let message = '';
    await stopper(401)('EG').catch((error: Error) => {
      message = error.message;
    });
    assert({
      given: 'an expired token',
      should: 'throw, so the row stays for the next check',
      actual: message,
      expected: 'stop egress answered 401',
    });
  });
});
