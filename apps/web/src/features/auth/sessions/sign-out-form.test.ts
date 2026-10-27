import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createSignOutFormHandler } from './sign-out-form';
import {
  createRecordingLogger,
  silentLogger,
} from '../../../server/test-loggers.test-support';

setupRitewayBun();

const ORIGIN = 'http://localhost:3000';
const CLEARED = 'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly';

const formPost = (origin: string | null, body = '') =>
  new Request(`${ORIGIN}/auth/sign-out`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: 'better-auth.session_token=abc',
      ...(origin ? { origin } : {}),
    },
    body,
  });

const handlerWith = (answer: Response) => {
  const calls: Request[] = [];
  const handler = createSignOutFormHandler({
    logger: silentLogger,
    origin: () => ORIGIN,
    signOut: async (request) => {
      calls.push(request);
      return answer;
    },
  });
  return { handler, calls };
};

const cleared = () =>
  new Response('{"success":true}', {
    status: 200,
    headers: { 'set-cookie': CLEARED },
  });

describe('the sign-out form (ISSUE-691)', () => {
  test('a same-origin form post signs out and lands signed out', async () => {
    const { handler, calls } = handlerWith(cleared());
    const response = await handler(formPost(ORIGIN));
    const sent = calls[0]!;
    assert({
      given: 'a native form post from the page, carrying the session cookie',
      should:
        'run the auth sign-out with that cookie and a JSON body, then 303 to /sign-in with its cleared cookie',
      actual: [
        new URL(sent.url).pathname,
        sent.method,
        sent.headers.get('cookie'),
        sent.headers.get('content-type'),
        await sent.text(),
        response.status,
        response.headers.get('location'),
        response.headers.getSetCookie(),
      ],
      expected: [
        '/api/auth/sign-out',
        'POST',
        'better-auth.session_token=abc',
        'application/json',
        '{}',
        303,
        '/sign-in',
        [CLEARED],
      ],
    });
  });

  test('a cross-site or origin-less post signs nobody out', async () => {
    const forged = handlerWith(cleared());
    const missing = handlerWith(cleared());
    const responses = [
      await forged.handler(formPost('https://evil.example')),
      await missing.handler(formPost(null)),
    ];
    assert({
      given: 'a post from another origin, and one with no Origin',
      should: 'refuse each with 403, call no sign-out and set no cookie',
      actual: [
        responses.map((response) => response.status),
        forged.calls.length + missing.calls.length,
        responses.flatMap((response) => response.headers.getSetCookie()),
      ],
      expected: [[403, 403], 0, []],
    });
  });

  test('a failed sign-out keeps the page instead of pretending', async () => {
    const { handler } = handlerWith(new Response(null, { status: 500 }));
    const { recorded, logger } = createRecordingLogger();
    const throwing = createSignOutFormHandler({
      logger,
      origin: () => ORIGIN,
      signOut: async () => {
        throw new Error('auth unavailable');
      },
    });
    const responses = [
      await handler(formPost(ORIGIN)),
      await throwing(formPost(ORIGIN)),
    ];
    assert({
      given: 'the auth sign-out answering 500, and throwing',
      should:
        'send the member back to /beta with a notice, still signed in, each time',
      actual: responses.map((response) => [
        response.status,
        response.headers.get('location'),
        response.headers.getSetCookie(),
      ]),
      expected: [
        [303, '/beta?signOut=failed', []],
        [303, '/beta?signOut=failed', []],
      ],
    });
    assert({
      given: 'the auth sign-out throwing',
      should:
        'log one fixed auth.sign_out.failed event carrying no error or request detail',
      actual: recorded,
      expected: [
        {
          event: 'auth.sign_out.failed',
          fields: { operation: 'auth.sign_out' },
          message: 'sign out failed',
        },
      ],
    });
  });

  test('a failure returns to the page the form names, never off-site (review F9)', async () => {
    const { handler } = handlerWith(new Response(null, { status: 500 }));
    const back = async (body: string) =>
      (await handler(formPost(ORIGIN, body))).headers.get('location');
    assert({
      given:
        'a failed sign-out from Settings, from a page with its own query, from an off-site next, and from an over-long body',
      should:
        'return to that page with the notice, keep its query, and fall back to /beta for anything not a safe local page',
      actual: [
        await back('next=%2Fsettings%2Fsecurity'),
        await back('next=%2Fsettings%3Ftab%3Dprivacy'),
        await back('next=%2F%2Fevil.example'),
        await back(`next=%2Fsettings&pad=${'x'.repeat(4096)}`),
      ],
      expected: [
        '/settings/security?signOut=failed',
        '/settings?tab=privacy&signOut=failed',
        '/beta?signOut=failed',
        '/beta?signOut=failed',
      ],
    });
  });

  test('a refused sign-out still carries the cookies auth cleared (review on #474)', async () => {
    const { handler } = handlerWith(
      new Response(null, { status: 401, headers: { 'set-cookie': CLEARED } }),
    );
    const response = await handler(formPost(ORIGIN, 'next=%2Fbeta'));
    assert({
      given:
        'the auth sign-out refusing a stale session while clearing its cookie',
      should:
        'return to the page with the notice and the cleared cookie, so a retry does not meet the same stale cookie',
      actual: [
        response.status,
        response.headers.get('location'),
        response.headers.getSetCookie(),
      ],
      expected: [303, '/beta?signOut=failed', [CLEARED]],
    });
  });
});
