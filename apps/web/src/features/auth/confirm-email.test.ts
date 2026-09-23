import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { seedSilentResources } from '../../server/seeded-resources.test-support';

setupRitewayBun();

// Seed process-local resources so handleOperation never builds real clients.
seedSilentResources();
const { createConfirmEmailHandlers } = await import('./confirm-email');
const { SESSION_CLEANUP_FAILED_HEADER } =
  await import('./revoke-others-on-verify-email');

const token = 'a'.repeat(32);
const PUBLIC_APP_URL = 'https://daisy.invalid';

/**
 * A fake Better Auth handler answering the one sub-request confirm-email
 * makes (verify-email). The atomic revoke of every other session now runs
 * inside Better Auth's own after-hook on that endpoint
 * (`revokeOthersOnVerifyEmailPlugin`), so this fake simulates its outcome
 * the same way the real hook reports it: via a response header.
 */
const handlersWith = (cleanupFailed = false) =>
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
              ...(cleanupFailed
                ? { [SESSION_CLEANUP_FAILED_HEADER]: 'true' }
                : {}),
            },
          });
        return new Response(null, { status: 404 });
      },
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
    const response = await handlersWith(false).POST(post());
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

  test('does not redirect as success when the endpoint flags a failed cleanup', async () => {
    const response = await handlersWith(true).POST(post());
    const body = await response.text();
    assert({
      given: 'a successful verification but a flagged cleanup failure',
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
