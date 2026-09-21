import { afterAll, beforeAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clearRedisNamespace,
  configureAppEnvironment,
  cookieHeader,
  counts,
  fixtureEmail,
  formPost,
  installMailbox,
  jsonPost,
  linkFrom,
  newClient,
  origin,
  removeAccount,
  withSql,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

setupRitewayBun();
configureAppEnvironment();

const mailbox = installMailbox();
const emails: string[] = [];
const fresh = () => {
  const email = fixtureEmail();
  emails.push(email);
  return email;
};

// Imported after the environment is configured; both are the real route modules.
const authRoute = await import('../src/app/api/auth/[...all]/route');
const confirmRoute = await import('../src/app/auth/confirm/route');
const { getResources } = await import('../src/server/resources');

/** Requests a link through the mounted handler and returns the emitted URL. */
const requestLink = async (
  email: string,
  body: Record<string, unknown> = {},
) => {
  const before = mailbox.mails.length;
  const response = await authRoute.POST(
    jsonPost('/api/auth/sign-in/magic-link', { email, ...body }),
  );
  return {
    response,
    mail: mailbox.mails[before],
    link: mailbox.mails[before] ? linkFrom(mailbox.mails[before]) : undefined,
  };
};
const tokenOf = (link: URL) => link.searchParams.get('token') ?? '';
const confirmGet = (link: URL, method: 'GET' | 'HEAD' = 'GET') =>
  confirmRoute[method](
    new Request(link, { method, headers: { [CLIENT_IP_HEADER]: newClient() } }),
  );
const redeem = (token: string, extra: Record<string, string> = {}) =>
  confirmRoute.POST(formPost({ token, callbackURL: '/lobby', ...extra }));

beforeAll(() => {
  // Warm the lazily-created resources so tests can observe their logger.
  getResources();
});
afterAll(async () => {
  mailbox.restore();
  for (const email of emails) await removeAccount(email);
  await clearRedisNamespace();
  await getResources().database.close();
  getResources().redis.close();
});

describe('AUTH-3.3 / AUTH-3.5 magic link through the mounted handlers', () => {
  test('signup: request → exact emitted link → scanner-safe view → explicit redeem → durable user, session and working cookie', async () => {
    const email = fresh();
    const { response, mail, link } = await requestLink(email);
    assert({
      given: 'a new email requested through the mounted /api/auth handler',
      should:
        'answer neutrally and send exactly one message with a /auth/confirm link',
      actual: {
        status: response.status,
        body: await response.json(),
        noStore: response.headers.get('cache-control'),
        hasRequestId: Boolean(response.headers.get('x-request-id')),
        to: mail?.to,
        subject: mail?.subject,
        path: link?.pathname,
        callback: link?.searchParams.get('callbackURL'),
        idempotent: Boolean(mail?.idempotencyKey),
      },
      expected: {
        status: 200,
        body: { status: true },
        noStore: 'no-store',
        hasRequestId: true,
        to: email,
        subject: 'Sign in to Daisy',
        path: '/auth/confirm',
        callback: '/lobby',
        idempotent: true,
      },
    });
    const token = tokenOf(link as URL);

    // Storage: hashed token, five-minute expiry, no user yet.
    const stored = await withSql(
      (sql) =>
        sql`SELECT identifier, value, expires_at FROM verification WHERE value LIKE ${`%${email}%`}`,
    );
    const ttlSeconds =
      (new Date(stored[0]?.expires_at).getTime() - Date.now()) / 1000;
    const plaintextRows = await withSql(
      (sql) => sql`SELECT 1 FROM verification WHERE identifier = ${token}`,
    );
    assert({
      given: 'the persisted verification record',
      should:
        'hold a hashed identifier (never the token), expire in five minutes and create no user',
      actual: {
        rows: stored.length,
        identifierIsToken: stored[0]?.identifier === token,
        plaintextLookup: plaintextRows.length,
        ttlWithinFiveMinutes: ttlSeconds > 240 && ttlSeconds <= 300,
        counts: await counts(email),
      },
      expected: {
        rows: 1,
        identifierIsToken: false,
        plaintextLookup: 0,
        ttlWithinFiveMinutes: true,
        counts: { users: 0, sessions: 0, verifications: 1 },
      },
    });

    // Scanners and prefetchers: repeated GET and HEAD never redeem.
    const scans = await Promise.all([
      confirmGet(link as URL),
      confirmGet(link as URL, 'HEAD'),
      confirmGet(link as URL),
      confirmGet(link as URL, 'HEAD'),
    ]);
    const page = await scans[0]?.text();
    assert({
      given: 'GET and HEAD visits to the emailed URL (mail scanner / prefetch)',
      should:
        'render a no-store confirmation page without consuming the token or creating a session',
      actual: {
        statuses: scans.map((scan) => scan.status),
        setCookies: scans.map((scan) => scan.headers.getSetCookie().length),
        noStore: scans.map((scan) => scan.headers.get('cache-control')),
        referrer: scans[0]?.headers.get('referrer-policy'),
        headBodies: [await scans[1]?.text(), await scans[3]?.text()],
        formPostsToConfirm: page?.includes(
          'method="post" action="/auth/confirm"',
        ),
        noThirdPartyAssets:
          !/(src|href)="https?:/.test(page ?? '') &&
          !/<script|<link|<img|<iframe/i.test(page ?? ''),
        counts: await counts(email),
      },
      expected: {
        statuses: [200, 200, 200, 200],
        setCookies: [0, 0, 0, 0],
        noStore: ['no-store', 'no-store', 'no-store', 'no-store'],
        referrer: 'no-referrer',
        headBodies: ['', ''],
        formPostsToConfirm: true,
        noThirdPartyAssets: true,
        counts: { users: 0, sessions: 0, verifications: 1 },
      },
    });

    // Explicit same-origin POST redeems once and hides the token.
    const confirmed = await redeem(token, {
      newUserCallbackURL: '/onboarding/username',
    });
    const location = confirmed.headers.get('location') ?? '';
    const cookie = cookieHeader(confirmed);
    const session = await authRoute.GET(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { cookie, [CLIENT_IP_HEADER]: newClient() },
      }),
    );
    const sessionBody = (await session.json()) as {
      user?: { email?: string; emailVerified?: boolean; id?: string };
    };
    const rows = await withSql(async (sql) => ({
      users:
        await sql`SELECT id, email, email_verified FROM users WHERE email = ${email}`,
      sessions:
        await sql`SELECT s.user_id FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
    }));
    assert({
      given:
        'an explicit same-origin confirmation POST of the exact emitted token',
      should:
        'redirect token-free with the session cookie, persist one verified user + session, and the cookie must authenticate',
      actual: {
        status: confirmed.status,
        location,
        locationHasToken: location.includes(token),
        cookies: confirmed.headers.getSetCookie().length > 0,
        userRows: rows.users.length,
        sessionRows: rows.sessions.length,
        sessionUserMatches: rows.sessions[0]?.user_id === rows.users[0]?.id,
        verifiedAndCuid2:
          rows.users[0]?.email_verified === true &&
          /^[a-z0-9]{24}$/.test(rows.users[0]?.id),
        cookieAuthenticates: sessionBody.user?.email === email,
        sessionVerified: sessionBody.user?.emailVerified,
      },
      expected: {
        status: 303,
        location: '/onboarding/username',
        locationHasToken: false,
        cookies: true,
        userRows: 1,
        sessionRows: 1,
        sessionUserMatches: true,
        verifiedAndCuid2: true,
        cookieAuthenticates: true,
        sessionVerified: true,
      },
    });

    // Replay of the consumed token.
    const replay = await redeem(token);
    assert({
      given: 'a replay of the already-consumed token',
      should: 'fail without a cookie, extra session or duplicate user',
      actual: {
        status: replay.status,
        location: replay.headers.get('location'),
        cookies: replay.headers.getSetCookie().length,
        counts: await counts(email),
      },
      expected: {
        status: 303,
        location: '/auth/confirm?error=INVALID_TOKEN',
        cookies: 0,
        counts: { users: 1, sessions: 1, verifications: 0 },
      },
    });
  });

  test('returning login reuses the account, honors the validated destination and never duplicates the user', async () => {
    const email = fresh();
    const first = await requestLink(email);
    await redeem(tokenOf(first.link as URL));
    const second = await requestLink(email.toUpperCase(), {
      callbackURL: '/play?tab=rules',
    });
    const destination = second.link?.searchParams.get('callbackURL');
    const confirmed = await redeem(tokenOf(second.link as URL), {
      callbackURL: destination ?? '',
    });
    assert({
      given: 'a returning user (case-varied address) with a local destination',
      should:
        'redirect to that destination with a fresh session and still exactly one user',
      actual: {
        location: confirmed.headers.get('location'),
        counts: await counts(email),
      },
      expected: {
        location: '/play?tab=rules',
        counts: { users: 1, sessions: 2, verifications: 0 },
      },
    });
  });

  test('concurrent redemption of one token authenticates exactly once', async () => {
    const email = fresh();
    const { link } = await requestLink(email);
    const token = tokenOf(link as URL);
    const results = await Promise.all(
      Array.from({ length: 16 }, () => redeem(token)),
    );
    const winners = results.filter(
      (result) => result.headers.getSetCookie().length > 0,
    );
    assert({
      given: 'sixteen simultaneous confirmations of the same token',
      should: 'issue exactly one session cookie, one user and one session',
      actual: {
        winners: winners.length,
        losers: results
          .filter((result) => result.headers.getSetCookie().length === 0)
          .map((result) => result.headers.get('location')),
        counts: await counts(email),
      },
      expected: {
        winners: 1,
        losers: Array(15).fill('/auth/confirm?error=INVALID_TOKEN'),
        counts: { users: 1, sessions: 1, verifications: 0 },
      },
    });
  });

  test('an expired link fails, then offers a user-initiated resend without any automatic send', async () => {
    const email = fresh();
    const { link } = await requestLink(email);
    // Move the stored expiry into the past instead of waiting five minutes.
    await withSql(
      (sql) =>
        sql`UPDATE verification SET expires_at = now() - interval '1 minute' WHERE value LIKE ${`%${email}%`}`,
    );
    const expired = await redeem(tokenOf(link as URL));
    const sentBefore = mailbox.mails.length;
    const expiredPage = await confirmRoute.GET(
      new Request(`${origin}${expired.headers.get('location')}`, {
        headers: { [CLIENT_IP_HEADER]: newClient() },
      }),
    );
    const html = await expiredPage.text();
    assert({
      given: 'a link past its five-minute expiry',
      should:
        'reject it with no session, then show a resend form and send nothing on view',
      actual: {
        location: expired.headers.get('location'),
        cookies: expired.headers.getSetCookie().length,
        counts: await counts(email),
        offersResend: html.includes('name="intent" value="resend"'),
        autoSent: mailbox.mails.length - sentBefore,
        noStore: expiredPage.headers.get('cache-control'),
      },
      expected: {
        location: '/auth/confirm?error=INVALID_TOKEN',
        cookies: 0,
        counts: { users: 0, sessions: 0, verifications: 0 },
        offersResend: true,
        autoSent: 0,
        noStore: 'no-store',
      },
    });
    const resend = await confirmRoute.POST(
      formPost({ intent: 'resend', email, callbackURL: '/lobby' }),
    );
    const resendHtml = await resend.text();
    assert({
      given: 'the person submitting the resend form',
      should: 'send exactly one new message and answer account-neutrally',
      actual: {
        status: resend.status,
        newMails: mailbox.mails.length - sentBefore,
        neutral: resendHtml.includes('If that address can receive email'),
      },
      expected: { status: 200, newMails: 1, neutral: true },
    });
  });

  test('foreign origins, missing origins and external destinations are rejected without redeeming', async () => {
    const email = fresh();
    const { link } = await requestLink(email);
    const token = tokenOf(link as URL);
    const foreign = await confirmRoute.POST(
      formPost(
        { token, callbackURL: '/lobby' },
        { origin: 'https://evil.example' },
      ),
    );
    const noOrigin = await confirmRoute.POST(
      new Request(`${origin}/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      }),
    );
    const authForeign = await authRoute.POST(
      jsonPost(
        '/api/auth/sign-in/magic-link',
        { email: fresh() },
        { origin: 'https://evil.example' },
      ),
    );
    const authBadCallback = await authRoute.POST(
      jsonPost('/api/auth/sign-in/magic-link', {
        email: fresh(),
        callbackURL: 'https://evil.example/steal',
      }),
    );
    const multipart = await confirmRoute.POST(
      new Request(`${origin}/auth/confirm`, {
        method: 'POST',
        headers: { origin, 'content-type': 'multipart/form-data; boundary=x' },
        body: '--x--',
      }),
    );
    assert({
      given:
        'cross-origin, origin-less, external-callback and wrong-type posts',
      should:
        'refuse each (403/403/403/403/400) and leave the token unconsumed',
      actual: {
        statuses: [
          foreign.status,
          noOrigin.status,
          authForeign.status,
          authBadCallback.status,
          multipart.status,
        ],
        cookies: [foreign, noOrigin, authForeign].map(
          (response) => response.headers.getSetCookie().length,
        ),
        counts: await counts(email),
      },
      expected: {
        statuses: [403, 403, 403, 403, 400],
        cookies: [0, 0, 0],
        counts: { users: 0, sessions: 0, verifications: 1 },
      },
    });

    const external = await redeem(token, {
      callbackURL: 'https://evil.example/steal',
    });
    assert({
      given: 'a confirm POST whose destination is external',
      should:
        'sign in but land on a safe local default, never the external URL',
      actual: external.headers.get('location'),
      expected: '/onboarding/username',
    });
  });

  test('provider failure surfaces a generic retryable error and never logs or echoes the link', async () => {
    const email = fresh();
    const resources = getResources();
    const logged: unknown[] = [];
    const original = resources.logger;
    resources.logger = {
      log: (...entry: unknown[]) => logged.push(entry),
      child: () => resources.logger,
    };
    try {
      mailbox.failNext('transient', 'transient');
      const failed = await authRoute.POST(
        jsonPost('/api/auth/sign-in/magic-link', { email }),
      );
      const text = await failed.text();
      // A retry after a permanent rejection must not send anything either.
      mailbox.failNext('permanent');
      const rejected = await authRoute.POST(
        jsonPost('/api/auth/sign-in/magic-link', { email }),
      );
      const sentAfterFailures = mailbox.mails.filter(
        (mail) => mail.to === email,
      ).length;
      const serialized = JSON.stringify(logged);
      assert({
        given: 'the provider failing transiently twice, then permanently',
        should:
          'answer 503 with a fixed retryable body, expose no provider/recipient detail and send nothing',
        actual: {
          statuses: [failed.status, rejected.status],
          code: (JSON.parse(text) as { code?: string }).code,
          retryAfter: failed.headers.get('retry-after'),
          leaks: ['upstream boom', email, 'resend', 'token='].filter((needle) =>
            text.toLowerCase().includes(needle.toLowerCase()),
          ),
          sentAfterFailures,
          logLeaks: ['token=', email, 'upstream boom', 'auth/confirm'].filter(
            (needle) => serialized.includes(needle),
          ),
        },
        expected: {
          statuses: [503, 503],
          code: 'EMAIL_DELIVERY_FAILED',
          retryAfter: '5',
          leaks: [],
          sentAfterFailures: 0,
          logLeaks: [],
        },
      });
    } finally {
      resources.logger = original;
    }
  });

  test('a successful request and redemption log completion without URLs, tokens, cookies or addresses', async () => {
    const email = fresh();
    const resources = getResources();
    const logged: unknown[] = [];
    const original = resources.logger;
    const capture = {
      log: (...entry: unknown[]) => logged.push(entry),
      child: () => capture,
    };
    resources.logger = capture;
    try {
      const { link } = await requestLink(email);
      const token = tokenOf(link as URL);
      const confirmed = await redeem(token);
      const serialized = JSON.stringify(logged);
      const cookieValue = cookieHeader(confirmed).split('=')[1] ?? '';
      assert({
        given: 'structured logs from a full sign-in',
        should: 'record completion events yet contain no credential material',
        actual: {
          logged: logged.length > 0,
          leaks: [
            token,
            email,
            cookieValue,
            'auth/confirm',
            'magic-link',
          ].filter(
            (needle) => needle.length > 0 && serialized.includes(needle),
          ),
        },
        expected: { logged: true, leaks: [] },
      });
    } finally {
      resources.logger = original;
    }
  });

  test('password, reset and delete surfaces are refused outright by the mounted handler', async () => {
    const email = fresh();
    const attempts = [
      [
        '/api/auth/sign-up/email',
        { email, password: 'Sup3rSecret!!', name: 'x' },
      ],
      ['/api/auth/sign-in/email', { email, password: 'Sup3rSecret!!' }],
      ['/api/auth/request-password-reset', { email }],
      ['/api/auth/forget-password', { email }],
      [
        '/api/auth/reset-password',
        { newPassword: 'Sup3rSecret!!', token: 'x' },
      ],
      ['/api/auth/change-password', { newPassword: 'a', currentPassword: 'b' }],
      ['/api/auth/set-password', { newPassword: 'Sup3rSecret!!' }],
      ['/api/auth/delete-user', {}],
    ] as const;
    const responses = await Promise.all(
      attempts.map(([path, body]) => authRoute.POST(jsonPost(path, body))),
    );
    assert({
      given: 'direct calls to every password, reset and delete endpoint',
      should: 'refuse all with 404, issue no cookie and create no user',
      actual: {
        statuses: responses.map((response) => response.status),
        cookies: responses.map(
          (response) => response.headers.getSetCookie().length,
        ),
        counts: await counts(email),
      },
      expected: {
        statuses: Array(attempts.length).fill(404),
        cookies: Array(attempts.length).fill(0),
        counts: { users: 0, sessions: 0, verifications: 0 },
      },
    });
  });
});
