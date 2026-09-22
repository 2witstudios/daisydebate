import { expect, type APIRequestContext } from '@playwright/test';
import { resolveE2EOrigin, resolveE2EPorts } from '../../playwright.config';

/**
 * Real accounts for the browser suite. Every step goes through the production
 * handlers: request a link, read it from the mail capture, redeem it at
 * /auth/confirm, claim a username. Nothing is seeded and no session is
 * forged; the cookie lands in the calling browser context.
 */
const mailBase = `http://127.0.0.1:${resolveE2EPorts(process.env).mail}`;
export const origin = resolveE2EOrigin(process.env);

let counter = 0;
export const uniqueName = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(counter += 1)}`.slice(0, 30);
export const freshEmail = () => `${uniqueName('e2e')}@example.test`;

/** Rate limits are per client and the browser is one client. */
export const resetRateLimits = async (request: APIRequestContext) => {
  await request.post(`${mailBase}/reset`);
};

/** Polls the capture for the newest link mailed to this address. */
export async function emailedLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let link: string | undefined;
  await expect(async () => {
    const response = await request.get(`${mailBase}/mails?to=${email}`);
    const mails = (await response.json()) as { text: string }[];
    expect(mails.length).toBeGreaterThan(0);
    link = mails.at(-1)?.text.match(/https:\/\/\S+/)?.[0];
    expect(link).toBeTruthy();
  }).toPass({ timeout: 10_000 });
  return link as string;
}

/**
 * Signs the context's browser in as a new member through the real handlers.
 * Use `context.request` (or `page.request`) so the session cookie is shared.
 */
export async function signUpMember(request: APIRequestContext) {
  await resetRateLimits(request);
  const email = freshEmail();
  const requested = await request.post('/api/auth/sign-in/magic-link', {
    headers: { origin },
    data: { email, callbackURL: '/lobby' },
  });
  expect(requested.status()).toBe(200);
  const token = new URL(await emailedLink(request, email)).searchParams.get(
    'token',
  );
  const confirmed = await request.post('/auth/confirm', {
    headers: { origin },
    form: { token: token ?? '', callbackURL: '/lobby' },
    maxRedirects: 0,
  });
  expect(confirmed.status()).toBe(303);
  const username = uniqueName('member');
  const claimed = await request.post('/api/account/username', {
    headers: { origin },
    data: { username },
  });
  expect(claimed.status()).toBe(201);
  return { email, username };
}
