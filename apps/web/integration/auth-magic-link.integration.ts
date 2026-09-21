import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createFlows, tokenOf } from './auth-mounted-flows';
import {
  counts,
  formPost,
  newClient,
  origin,
  withSql,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();
const flows = await createFlows();
const { requestLink, redeem, confirmGet, confirmRoute, startSignup } = flows;
const { mailbox } = flows;

describe('AUTH-3.3 magic link request through the mounted handler', () => {
  test('a new email gets an account-neutral answer and exactly one /auth/confirm link', async () => {
    const { response, mail, link, email } = await startSignup();
    assert({
      given: 'a new email requested through the mounted /api/auth handler',
      should:
        'answer neutrally and send exactly one message with a /auth/confirm link',
      actual: {
        status: response.status,
        body: await response.json(),
        noStore: response.headers.get('cache-control'),
        hasRequestId: Boolean(response.headers.get('x-request-id')),
        to: mail?.to === email,
        subject: mail?.subject,
        path: link.pathname,
        callback: link.searchParams.get('callbackURL'),
        idempotent: Boolean(mail?.idempotencyKey),
      },
      expected: {
        status: 200,
        body: { status: true },
        noStore: 'no-store',
        hasRequestId: true,
        to: true,
        subject: 'Sign in to Daisy',
        path: '/auth/confirm',
        callback: '/lobby',
        idempotent: true,
      },
    });
  });

  test('the token is stored hashed with a five-minute expiry and no user exists yet', async () => {
    const { email, token } = await startSignup();
    const stored = await withSql(
      (sql) =>
        sql`SELECT identifier, expires_at FROM verification WHERE value LIKE ${`%${email}%`}`,
    );
    const plaintext = await withSql(
      (sql) => sql`SELECT 1 FROM verification WHERE identifier = ${token}`,
    );
    const seconds =
      (new Date(stored[0]?.expires_at).getTime() - Date.now()) / 1000;
    assert({
      given: 'the persisted verification record for a fresh link',
      should:
        'hold a hashed identifier (never the token), expire within five minutes and create no user',
      actual: {
        rows: stored.length,
        identifierIsToken: stored[0]?.identifier === token,
        plaintextLookup: plaintext.length,
        fiveMinutes: seconds > 240 && seconds <= 300,
        counts: await counts(email),
      },
      expected: {
        rows: 1,
        identifierIsToken: false,
        plaintextLookup: 0,
        fiveMinutes: true,
        counts: { users: 0, sessions: 0, verifications: 1 },
      },
    });
  });
});

describe('AUTH-3.5 scanner-safe confirmation and single-use redemption', () => {
  test('GET and HEAD visits (scanner, prefetch) render a safe page without redeeming', async () => {
    const { email, link } = await startSignup();
    const scans = await Promise.all([
      confirmGet(link),
      confirmGet(link, 'HEAD'),
      confirmGet(link),
      confirmGet(link, 'HEAD'),
    ]);
    const page = await scans[0]?.text();
    assert({
      given: 'GET and HEAD visits to the emailed URL',
      should:
        'return a no-store, referrer-free page with no cookie, asset or redemption',
      actual: {
        statuses: scans.map((scan) => scan.status),
        setCookies: scans.map((scan) => scan.headers.getSetCookie().length),
        noStore: scans.map((scan) => scan.headers.get('cache-control')),
        referrer: scans[0]?.headers.get('referrer-policy'),
        headBodies: [await scans[1]?.text(), await scans[3]?.text()],
        formPosts: page?.includes('method="post" action="/auth/confirm"'),
        noAssets: !/<script|<link|<img|<iframe|(src|href)="https?:/i.test(
          page ?? '',
        ),
        counts: await counts(email),
      },
      expected: {
        statuses: [200, 200, 200, 200],
        setCookies: [0, 0, 0, 0],
        noStore: Array(4).fill('no-store'),
        referrer: 'no-referrer',
        headBodies: ['', ''],
        formPosts: true,
        noAssets: true,
        counts: { users: 0, sessions: 0, verifications: 1 },
      },
    });
  });

  test('an explicit same-origin POST redeems the exact emitted token once: token-free redirect, verified user, session and working cookie', async () => {
    const { email, token } = await startSignup();
    const confirmed = await redeem(token, {
      newUserCallbackURL: '/onboarding/username',
    });
    const location = confirmed.headers.get('location') ?? '';
    const active = await flows.session(confirmed);
    const body = (await active.json()) as {
      user?: { email?: string; emailVerified?: boolean };
    };
    const users = await flows.userRows(email);
    const sessions = await withSql(
      (sql) =>
        sql`SELECT s.user_id FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
    );
    assert({
      given: 'a confirmation POST of the exact emitted token',
      should:
        'redirect without the token, persist one verified cuid2 user and session, and the cookie must authenticate',
      actual: {
        status: confirmed.status,
        location,
        tokenInLocation: location.includes(token),
        cookie: confirmed.headers.getSetCookie().length > 0,
        users: users.length,
        sessions: sessions.length,
        sameUser: sessions[0]?.user_id === users[0]?.id,
        verified: users[0]?.email_verified === true,
        cuid2: /^[a-z0-9]{24}$/.test(users[0]?.id ?? ''),
        cookieAuthenticates: body.user?.email === email,
        emailVerified: body.user?.emailVerified,
      },
      expected: {
        status: 303,
        location: '/onboarding/username',
        tokenInLocation: false,
        cookie: true,
        users: 1,
        sessions: 1,
        sameUser: true,
        verified: true,
        cuid2: true,
        cookieAuthenticates: true,
        emailVerified: true,
      },
    });
  });

  test('a replay of a consumed token fails with no cookie, extra session or duplicate user', async () => {
    const { email, token } = await startSignup();
    await redeem(token);
    const replay = await redeem(token);
    assert({
      given: 'a replay of the already-consumed token',
      should: 'redirect to the expired view without authenticating again',
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

  test('concurrent redemption of one token authenticates exactly once', async () => {
    const { email, token } = await startSignup();
    const results = await Promise.all(
      Array.from({ length: 16 }, () => redeem(token)),
    );
    const cookies = (result: Response) => result.headers.getSetCookie().length;
    assert({
      given: 'sixteen simultaneous confirmations of the same token',
      should: 'issue exactly one session cookie, one user and one session',
      actual: {
        winners: results.filter((result) => cookies(result) > 0).length,
        losers: results
          .filter((result) => cookies(result) === 0)
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
});

describe('AUTH-3.3 / AUTH-3.5 returning users and expired links', () => {
  test('a returning user (case-varied address) reuses the account and honors a local destination', async () => {
    const { email, token } = await startSignup();
    await redeem(token);
    const second = await requestLink(email.toUpperCase(), {
      callbackURL: '/play?tab=rules',
    });
    const destination = second.link?.searchParams.get('callbackURL') ?? '';
    const confirmed = await redeem(tokenOf(second.link as URL), {
      callbackURL: destination,
    });
    assert({
      given: 'a returning user with a local destination',
      should: 'redirect there with a fresh session and still exactly one user',
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

  test('an expired link fails and the expired view sends nothing by itself', async () => {
    const { email, token } = await startSignup();
    // Move the stored expiry into the past instead of waiting five minutes.
    await withSql(
      (sql) =>
        sql`UPDATE verification SET expires_at = now() - interval '1 minute' WHERE value LIKE ${`%${email}%`}`,
    );
    const expired = await redeem(token);
    const before = mailbox.mails.length;
    const view = await confirmRoute.GET(
      new Request(`${origin}${expired.headers.get('location')}`, {
        headers: { [CLIENT_IP_HEADER]: newClient() },
      }),
    );
    const html = await view.text();
    assert({
      given: 'a link past its five-minute expiry',
      should:
        'reject it with no session, then show a resend form without sending on view',
      actual: {
        location: expired.headers.get('location'),
        cookies: expired.headers.getSetCookie().length,
        counts: await counts(email),
        offersResend: html.includes('name="intent" value="resend"'),
        autoSent: mailbox.mails.length - before,
        noStore: view.headers.get('cache-control'),
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
  });

  test('the person submitting the resend form gets exactly one new message and a neutral answer', async () => {
    const email = flows.fresh();
    const before = mailbox.mails.length;
    const resend = await confirmRoute.POST(
      formPost({ intent: 'resend', email, callbackURL: '/lobby' }),
    );
    assert({
      given: 'the resend form submitted for an address',
      should: 'send one message and answer without confirming the account',
      actual: {
        status: resend.status,
        newMails: mailbox.mails.length - before,
        neutral: (await resend.text()).includes(
          'If that address can receive email',
        ),
      },
      expected: { status: 200, newMails: 1, neutral: true },
    });
  });
});
