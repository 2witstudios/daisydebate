import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createClaimUsername, inProcessFetch } from './claim-username';

setupRitewayBun();

const answering = (response: Response | Error) => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { requests, claim: createClaimUsername(fetchImpl) };
};

describe('createClaimUsername', () => {
  test('posts exactly the username and reports the stored name', async () => {
    const { claim, requests } = answering(
      Response.json({ username: 'ada' }, { status: 201 }),
    );
    assert({
      given: 'a 201 from the endpoint',
      should: 'post only { username } and report claimed',
      actual: [
        await claim('Ada'),
        requests[0]?.url,
        requests[0]?.init?.body,
        requests[0]?.init?.method,
      ],
      expected: [
        { kind: 'claimed', username: 'ada' },
        '/api/account/username',
        '{"username":"Ada"}',
        'POST',
      ],
    });
  });

  test('an idempotent retry (200) is also claimed', async () => {
    assert({
      given: 'a 200 from the endpoint',
      should: 'report claimed',
      actual: await answering(Response.json({ username: 'ada' })).claim('ada'),
      expected: { kind: 'claimed', username: 'ada' },
    });
  });

  test('maps each refusal to its recoverable outcome', async () => {
    const outcome = async (response: Response | Error) =>
      (await answering(response).claim('ada')).kind;
    assert({
      given:
        'invalid, signed-out, throttled, taken, already-set, 5xx and network failures',
      should: 'map each to its own outcome',
      actual: [
        await outcome(new Response(null, { status: 400 })),
        await outcome(new Response(null, { status: 401 })),
        await outcome(new Response(null, { status: 429 })),
        await outcome(
          Response.json({ error: { code: 'USERNAME_TAKEN' } }, { status: 409 }),
        ),
        await outcome(
          Response.json(
            { error: { code: 'USERNAME_ALREADY_SET' } },
            { status: 409 },
          ),
        ),
        await outcome(new Response(null, { status: 503 })),
        await outcome(new Error('offline')),
        await outcome(new Response('not json', { status: 201 })),
      ],
      expected: [
        'invalid',
        'signed-out',
        'rate-limited',
        'taken',
        'already-set',
        'unavailable',
        'unavailable',
        'unavailable',
      ],
    });
  });
});

describe('inProcessFetch', () => {
  test('hands the handler the claim with the browser request credentials', async () => {
    const seen: Request[] = [];
    const incoming = new Headers({
      origin: 'https://daisy.test',
      cookie: '__Secure-daisy.session_token=abc',
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': '120',
    });
    const claim = createClaimUsername(
      inProcessFetch(async (request) => {
        seen.push(request);
        return Response.json({ username: 'ada' }, { status: 201 });
      }, incoming),
    );
    const outcome = await claim('Ada');
    const request = seen[0];
    assert({
      given: 'a claim made while serving a browser form post',
      should:
        'call the handler with its Origin and cookie and the JSON claim body',
      actual: {
        outcome,
        method: request?.method,
        path: request === undefined ? undefined : new URL(request.url).pathname,
        origin: request?.headers.get('origin'),
        cookie: request?.headers.get('cookie'),
        type: request?.headers.get('content-type'),
        body: await request?.text(),
      },
      expected: {
        outcome: { kind: 'claimed', username: 'ada' },
        method: 'POST',
        path: '/api/account/username',
        origin: 'https://daisy.test',
        cookie: '__Secure-daisy.session_token=abc',
        type: 'application/json',
        body: '{"username":"Ada"}',
      },
    });
  });
});
