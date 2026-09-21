import { afterAll, beforeAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clearRedisNamespace,
  configureAppEnvironment,
  fixtureEmail,
  installMailbox,
  linkFrom,
  newClient,
  removeAccount,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();
// Registers the shared reset hook first; the https override below runs after it.
configureAppEnvironment();

const httpsOrigin = 'https://daisy.example.com';
const mailbox = installMailbox();
const emails: string[] = [];
const cachedKeys = ['daisyResources', 'daisyAuth', 'daisyMailWebhook'];

/** Drops the process-wide compositions so the next request rebuilds them. */
async function resetCaches() {
  const state = globalThis as Record<string, unknown>;
  const resources = state.daisyResources as
    | { database: { close: () => Promise<void> }; redis: { close: () => void } }
    | undefined;
  await Promise.allSettled([
    resources?.database.close(),
    Promise.resolve().then(() => resources?.redis.close()),
  ]);
  for (const key of cachedKeys) delete state[key];
}

let authRoute: typeof import('../src/app/api/auth/[...all]/route');
let confirmRoute: typeof import('../src/app/auth/confirm/route');

beforeAll(async () => {
  await resetCaches();
  process.env.PUBLIC_APP_URL = httpsOrigin;
  authRoute = await import('../src/app/api/auth/[...all]/route');
  confirmRoute = await import('../src/app/auth/confirm/route');
});

afterAll(async () => {
  for (const email of emails) await removeAccount(email);
  await clearRedisNamespace();
  await resetCaches();
  process.env.PUBLIC_APP_URL = 'http://localhost:3000';
});

const fresh = () => {
  const email = fixtureEmail();
  emails.push(email);
  return email;
};

const requestLink = async (email: string) => {
  const before = mailbox.mails.length;
  const response = await authRoute.POST(
    new Request(`${httpsOrigin}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: httpsOrigin,
        [CLIENT_IP_HEADER]: newClient(),
      },
      body: JSON.stringify({ email }),
    }),
  );
  const mail = mailbox.mails[before];
  return { response, link: mail ? linkFrom(mail) : undefined };
};

const redeem = (token: string) =>
  confirmRoute.POST(
    new Request(`${httpsOrigin}/auth/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: httpsOrigin,
        [CLIENT_IP_HEADER]: newClient(),
      },
      body: new URLSearchParams({ token, callbackURL: '/lobby' }).toString(),
    }),
  );

const answer = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
  headers: [...response.headers.entries()]
    .filter(([name]) => !['x-request-id', 'date'].includes(name))
    .sort(([a], [b]) => a.localeCompare(b)),
});

describe('AUTH-3 session cookie under an https origin', () => {
  test('magic-link redemption sets a __Secure- prefixed HttpOnly Secure SameSite=Lax cookie', async () => {
    const { link } = await requestLink(fresh());
    const confirmed = await redeem(link?.searchParams.get('token') ?? '');
    const cookies = confirmed.headers
      .getSetCookie()
      .map((cookie) => cookie.replace(/=[^;]+/, '=<value>'));
    assert({
      given: 'a magic-link redemption under an https PUBLIC_APP_URL',
      should: 'set the __Secure- session cookie with hardened attributes',
      actual: { status: confirmed.status, cookies },
      expected: {
        status: 303,
        cookies: [
          '__Secure-better-auth.session_token=<value>; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax',
        ],
      },
    });
  });
});

describe('AUTH-3 account neutrality of the magic-link request', () => {
  test('an existing verified user and a brand-new address get identical answers', async () => {
    const existing = fresh();
    const first = await requestLink(existing);
    await redeem(first.link?.searchParams.get('token') ?? '');
    const known = await requestLink(existing);
    const unknown = await requestLink(fresh());
    const knownAnswer = await answer(known.response);
    const unknownAnswer = await answer(unknown.response);
    assert({
      given: 'a request for an existing verified user vs a brand-new address',
      should: 'return identical status, body and neutral headers',
      actual: { same: knownAnswer, other: unknownAnswer },
      expected: { same: unknownAnswer, other: unknownAnswer },
    });
    assert({
      given: 'the neutral answer itself',
      should: 'be 200 {"status":true} with no cookie and no-store',
      actual: {
        status: knownAnswer.status,
        body: knownAnswer.body,
        cookies: known.response.headers.getSetCookie().length,
        noStore: known.response.headers.get('cache-control'),
      },
      expected: {
        status: 200,
        body: '{"status":true}',
        cookies: 0,
        noStore: 'no-store',
      },
    });
  });
});
