import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createAccountFlows,
  sessionCount,
  uniqueName,
  usernameOf,
} from './auth-account-helpers';
import { withSql } from './auth-mounted-helpers';
import { decideAccess } from '../src/features/access/decision';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();
const { flows, identify, signUp, claim } = await createAccountFlows();
const { requestLink, redeem, session } = flows;
const tokenOf = (link: URL) => link.searchParams.get('token') ?? '';

describe('AUTH-4.4 / 4.2 sign-in loop through the real handlers', () => {
  test('request → emailed link → confirm → durable session → username → participant access', async () => {
    const { email, response, cookie } = await signUp();
    const sessionRows = await sessionCount(email);
    const provisional = await identify(cookie);
    const beforeAccess = decideAccess({
      identity: provisional,
      path: '/lobby',
      requirement: 'participant',
    });
    const name = uniqueName();
    const claimed = await claim(cookie, { username: name.toUpperCase() });
    const member = await identify(cookie);
    assert({
      given:
        'a new address that requests a link and redeems it at /auth/confirm',
      should:
        'land on onboarding with a durable session, be provisional, claim a username, then be a member',
      actual: {
        redirect: [response.status, response.headers.get('location')],
        sessionRows,
        provisional: provisional.state,
        provisionalPermissions:
          provisional.principal.kind === 'user'
            ? provisional.principal.permissions
            : 'n/a',
        beforeAccess,
        claim: [claimed.status, await claimed.json()],
        member: member.state === 'member' ? member.username : member.state,
        memberPermissions:
          member.principal.kind === 'user' ? member.principal.permissions : [],
        afterAccess: decideAccess({
          identity: member,
          path: '/lobby',
          requirement: 'participant',
        }),
        stored: await usernameOf(email),
      },
      expected: {
        redirect: [303, '/onboarding/username?next=/lobby'],
        sessionRows: 1,
        provisional: 'provisional',
        provisionalPermissions: [],
        beforeAccess: {
          kind: 'redirect',
          to: '/onboarding/username?next=%2Flobby',
        },
        claim: [201, { username: name }],
        member: name,
        memberPermissions: ['debate:create'],
        afterAccess: { kind: 'allow' },
        stored: name,
      },
    });
  });

  test('replaying a redeemed link is rejected and mints no session', async () => {
    const { email, token } = await signUp();
    const replay = await redeem(token);
    const sessions = await sessionCount(email);
    assert({
      given: 'the same emailed link redeemed a second time',
      should:
        'set no cookie, create no second session and redirect to the expired view',
      actual: {
        setsCookie: replay.headers.getSetCookie().length,
        sessions,
        redirect: [replay.status, replay.headers.get('location')],
      },
      expected: {
        setsCookie: 0,
        sessions: 1,
        redirect: [303, '/auth/confirm?error=INVALID_TOKEN'],
      },
    });
  });

  test('an unknown or forged cookie resolves anonymous', async () => {
    const forged = await identify('better-auth.session_token=forged.value');
    assert({
      given: 'a cookie that names no durable session',
      should: 'resolve anonymous and be sent to sign-in',
      actual: [
        forged.state,
        decideAccess({
          identity: forged,
          path: '/play',
          requirement: 'participant',
        }),
      ],
      expected: [
        'anonymous',
        { kind: 'redirect', to: '/sign-in?next=%2Fplay' },
      ],
    });
  });

  test('a revoked session is anonymous on the very next check', async () => {
    const { email, cookie } = await signUp();
    await claim(cookie, { username: uniqueName() });
    const before = (await identify(cookie)).state;
    await withSql(
      (sql) =>
        sql`DELETE FROM session WHERE user_id = (SELECT id FROM users WHERE email = ${email})`,
    );
    assert({
      given: 'a member whose session row is deleted',
      should: 'resolve anonymous immediately (no cookie cache)',
      actual: [before, (await identify(cookie)).state],
      expected: ['member', 'anonymous'],
    });
  });

  test('server reads never slide a session; the browser refresh slides row and cookie together', async () => {
    const { email, cookie, response } = await signUp();
    // Age the session past updateAge (1 day) without expiring it (7 days).
    await withSql(
      (sql) =>
        sql`UPDATE session SET expires_at = now() + interval '5 days' WHERE user_id = (SELECT id FROM users WHERE email = ${email})`,
    );
    const expiry = async () =>
      (
        (await withSql(
          (sql) =>
            sql`SELECT extract(epoch FROM expires_at - now())::int AS s FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
        )) as { s: number }[]
      )[0]?.s ?? 0;
    const day = 24 * 60 * 60;
    const aged = await expiry();
    const read = await identify(cookie);
    const afterRead = await expiry();
    const refreshed = await session(response);
    const afterRefresh = await expiry();
    assert({
      given: 'a member session aged past updateAge',
      should:
        'leave the row alone on a server read, and extend it with a new cookie through get-session',
      actual: {
        read: read.state,
        readLeftRow: Math.abs(afterRead - aged) < 5,
        refreshStatus: refreshed.status,
        refreshSetsCookie: refreshed.headers
          .getSetCookie()
          .some((line) => line.includes('session_token=')),
        extendedToSevenDays: afterRefresh > 7 * day - 60,
      },
      expected: {
        read: 'provisional',
        readLeftRow: true,
        refreshStatus: 200,
        refreshSetsCookie: true,
        extendedToSevenDays: true,
      },
    });
  });

  test('an expired session is anonymous', async () => {
    const { email, cookie } = await signUp();
    await withSql(
      (sql) =>
        sql`UPDATE session SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE email = ${email})`,
    );
    assert({
      given: 'a session past its expiry',
      should: 'resolve anonymous',
      actual: (await identify(cookie)).state,
      expected: 'anonymous',
    });
  });
});

describe('sign-in request through the real endpoint', () => {
  test('a link request carries the destination and a new-user onboarding route', async () => {
    const email = flows.fresh();
    const { response, link } = await requestLink(email, {
      callbackURL: '/ranked',
      newUserCallbackURL: '/onboarding/username?next=%2Franked',
    });
    assert({
      given: 'the sign-in page asking for a link with its destinations',
      should: 'email a /auth/confirm link that carries both',
      actual: [
        response.status,
        link?.searchParams.get('callbackURL'),
        link?.searchParams.get('newUserCallbackURL'),
        tokenOf(link as URL).length > 16,
      ],
      expected: [200, '/ranked', '/onboarding/username?next=%2Franked', true],
    });
  });
});
