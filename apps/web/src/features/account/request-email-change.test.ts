import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requestEmailChange } from './request-email-change';
import { jsonResponse } from './security-client.test-support';

setupRitewayBun();

describe('requestEmailChange', () => {
  const answering = (response: Response | Error) => {
    const requests: { url: string; init: RequestInit }[] = [];
    const send = async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    };
    return { requests, send };
  };

  test('starts the change over the Better Auth route', async () => {
    const { requests, send } = answering(jsonResponse({ status: true }));
    const outcome = await requestEmailChange('new@example.test', send);
    assert({
      given: 'an accepted change',
      should:
        'report ok, having posted the new address and the page to return to',
      actual: {
        outcome,
        url: requests[0]?.url,
        method: requests[0]?.init.method,
        headers: requests[0]?.init.headers,
        body: JSON.parse(String(requests[0]?.init.body)) as unknown,
      },
      expected: {
        outcome: { kind: 'ok' },
        url: '/api/auth/change-email',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          newEmail: 'new@example.test',
          callbackURL: '/settings/security',
        },
      },
    });
  });

  test('maps refusals from the Better Auth error body', async () => {
    const outcome = async (response: Response | Error) =>
      (await requestEmailChange('x@example.test', answering(response).send))
        .kind;
    assert({
      given:
        'a stale session, a taken address, throttling, bad input, an unreadable body and no answer',
      should:
        'answer stale-session, conflict, rate-limited, invalid, unavailable, unavailable',
      actual: [
        await outcome(
          jsonResponse({ code: 'SESSION_NOT_FRESH', message: 'stale' }, 403),
        ),
        await outcome(jsonResponse({ code: 'EMAIL_TAKEN' }, 409)),
        await outcome(new Response(null, { status: 429 })),
        await outcome(jsonResponse({ code: 'INVALID_EMAIL' }, 400)),
        await outcome(new Response('<html>', { status: 502 })),
        await outcome(new Error('network down')),
      ],
      expected: [
        'stale-session',
        'conflict',
        'rate-limited',
        'invalid',
        'unavailable',
        'unavailable',
      ],
    });
  });
});
