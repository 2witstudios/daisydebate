import { expect, test } from '@playwright/test';
import { origin } from './support/accounts';

// The production server (NODE_ENV=production, HTTPS public origin, real
// ingress stamping) with the auth routes mounted. Header behavior is asserted
// on the served responses, not on route-module return values.
const token = 'e2eTokenNotARealCredential0123456789';

test('the confirmation page is scanner-safe under the production server', async ({
  request,
}) => {
  const get = await request.get(`/auth/confirm?token=${token}`);
  const head = await request.head(`/auth/confirm?token=${token}`);
  for (const response of [get, head]) {
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(response.headers()['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
  const html = await get.text();
  expect(html).toContain('method="post" action="/auth/confirm"');
  expect(html).not.toMatch(/<script|<link|<img|<iframe/i);
});

test('auth routes answer with correlation, no-store and refuse foreign origins and passwords', async ({
  request,
}) => {
  const session = await request.get('/api/auth/get-session');
  expect(session.status()).toBe(200);
  expect(session.headers()['x-request-id']).toBeTruthy();
  expect(session.headers()['cache-control']).toContain('no-store');

  const foreign = await request.post('/api/auth/sign-in/magic-link', {
    headers: { origin: 'https://evil.example' },
    data: { email: 'someone@example.test' },
  });
  expect(foreign.status()).toBe(403);

  const password = await request.post('/api/auth/sign-in/email', {
    headers: { origin },
    data: { email: 'someone@example.test', password: 'Sup3rSecret!!' },
  });
  expect(password.status()).toBe(404);
  expect(password.headers()['set-cookie']).toBeUndefined();
});

test('a wrong-origin confirmation POST is refused and leaves no cookie', async ({
  request,
}) => {
  const response = await request.post('/auth/confirm', {
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/x-www-form-urlencoded',
    },
    data: `token=${token}`,
  });
  expect(response.status()).toBe(403);
  expect(response.headers()['set-cookie']).toBeUndefined();
});

test('the Resend webhook refuses unsigned requests', async ({ request }) => {
  const response = await request.post('/api/webhooks/resend', {
    data: { type: 'email.delivered', data: { email_id: 'msg_e2e' } },
  });
  expect(response.status()).toBe(400);
});
