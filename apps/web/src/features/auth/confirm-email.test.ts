import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { seedSilentResources } from '../../server/seeded-resources.test-support';

setupRitewayBun();

// Seed process-local resources so handleOperation never builds real clients.
seedSilentResources();
const { createConfirmEmailHandlers } = await import('./confirm-email');

const token = 'a'.repeat(32);
const PUBLIC_APP_URL = 'https://daisy.invalid';

type Behavior = {
  readonly revokeOtherSessions?: (
    userId: string,
    keepToken: string,
  ) => Promise<number>;
};

/**
 * A fake Better Auth handler answering the two sub-requests confirm-email
 * makes (verify-email, get-session), plus an injectable atomic revocation
 * standing in for the post-verification session cleanup.
 */
const handlersWith = (behavior: Behavior = {}) =>
  createConfirmEmailHandlers({
    auth: () => ({
      config: { PUBLIC_APP_URL },
      handler: async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/auth/verify-email')
          return new Response(null, {
            status: 200,
            headers: {
              'set-cookie': 'better-auth.session_token=new; Path=/',
            },
          });
        if (url.pathname === '/api/auth/get-session')
          return new Response(
            JSON.stringify({ session: { token: 'new', userId: 'u1' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        return new Response(null, { status: 404 });
      },
      revokeOtherSessions: behavior.revokeOtherSessions ?? (async () => 1),
    }),
  });

const post = () =>
  new Request(`${PUBLIC_APP_URL}/auth/confirm-email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: PUBLIC_APP_URL,
    },
    body: new URLSearchParams({
      token,
      callbackURL: '/settings/security',
    }).toString(),
  });

describe('confirm-email: post-verification session revocation', () => {
  test('redirects to the destination once every other session is confirmed revoked', async () => {
    const response = await handlersWith().POST(post());
    assert({
      given: 'a successful verification and revocation',
      should: 'redirect with the new session cookie, not render a warning',
      actual: {
        status: response.status,
        location: response.headers.get('location'),
      },
      expected: { status: 303, location: '/settings/security' },
    });
  });

  test('does not redirect as success when the atomic revocation fails', async () => {
    const response = await handlersWith({
      revokeOtherSessions: async () => {
        throw new Error('boom');
      },
    }).POST(post());
    const body = await response.text();
    assert({
      given: 'a successful verification but a failing revocation call',
      should:
        'answer an error status carrying the new cookie, not the success redirect',
      actual: {
        status: response.status,
        cookieCarried: response.headers.getSetCookie().length > 0,
        mentionsIncomplete: body.includes('cleanup step failed'),
      },
      expected: { status: 502, cookieCarried: true, mentionsIncomplete: true },
    });
  });
});
