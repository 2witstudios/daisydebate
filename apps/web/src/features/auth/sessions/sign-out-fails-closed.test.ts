import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { signOutFailsClosedPlugin } from './sign-out-fails-closed';

setupRitewayBun();

const beforeHook = () => {
  const hook = signOutFailsClosedPlugin.hooks?.before?.[0];
  if (!hook) throw new Error('plugin defines no before hook');
  return hook;
};

const cookieName = 'daisy.session_token';
const secret = 'a-test-secret-of-sufficient-length';

/** better-call's signed cookie: `value.base64(HMAC-SHA256)`, URI-encoded. */
const signedCookie = async (value: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)),
  );
  return `${cookieName}=${encodeURIComponent(
    `${value}.${btoa(String.fromCharCode(...signature))}`,
  )}`;
};

const context = async (
  path: string,
  token: string | null,
  deleteSession: (token: string) => Promise<void>,
) => ({
  path,
  headers: new Headers(token ? { cookie: await signedCookie(token) } : {}),
  context: {
    authCookies: { sessionToken: { name: cookieName } },
    secret,
    internalAdapter: { deleteSession },
  },
});

describe('signOutFailsClosedPlugin', () => {
  test('matches only the sign-out path', () => {
    const hook = beforeHook();
    assert({
      given: 'sign-out and two other session paths',
      should: 'match sign-out only',
      actual: ['/sign-out', '/revoke-session', '/get-session'].map((path) =>
        hook.matcher({ path } as never),
      ),
      expected: [true, false, false],
    });
  });

  test('deletes the signed-in session before the endpoint runs', async () => {
    const deleted: string[] = [];
    await beforeHook().handler(
      (await context('/sign-out', 'the-token', async (token) => {
        deleted.push(token);
      })) as never,
    );
    assert({
      given: 'a sign-out carrying a signed session cookie',
      should: 'delete exactly that session',
      actual: deleted,
      expected: ['the-token'],
    });
  });

  test('deletes nothing without a session cookie', async () => {
    const deleted: string[] = [];
    await beforeHook().handler(
      (await context('/sign-out', null, async (token) => {
        deleted.push(token);
      })) as never,
    );
    assert({
      given: 'a sign-out with no valid signed session cookie',
      should: 'leave the endpoint to answer as before',
      actual: deleted,
      expected: [],
    });
  });

  test('propagates a failed delete instead of letting sign-out succeed', async () => {
    const failure = new Error('outbox append refused');
    const caught = await beforeHook()
      .handler(
        (await context('/sign-out', 'the-token', async () => {
          throw failure;
        })) as never,
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    assert({
      given: 'a session delete that does not commit',
      should:
        'fail the sign-out with that failure before any cookie is cleared',
      actual: caught,
      expected: failure,
    });
  });
});
