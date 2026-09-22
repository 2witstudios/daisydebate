import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createFlows } from './auth-mounted-flows';
import {
  cookieHeader,
  jsonPost,
  origin,
  withSql,
} from './auth-mounted-helpers';
import { decideAccess } from '../src/features/access/decision';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { newClient } from './auth-mounted-helpers';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();
const flows = await createFlows();
const { requestLink, redeem, startSignup, authRoute } = flows;
const { identify } = await import('../src/lib/identity');
const usernameRoute = await import('../src/app/api/account/username/route');

const tokenOf = (link: URL) => link.searchParams.get('token') ?? '';

/** A brand-new account signed in through the real request → confirm path. */
const signUp = async () => {
  const { email, token } = await startSignup();
  const response = await redeem(token, {
    newUserCallbackURL: '/onboarding/username?next=%2Flobby',
  });
  return { email, token, response, cookie: cookieHeader(response) };
};

const claim = (
  cookie: string | null,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  usernameRoute.POST(
    jsonPost('/api/account/username', body, {
      ...(cookie ? { cookie } : {}),
      ...headers,
    }),
  );

const uniqueName = () => `u${createId().slice(0, 14)}`;
const usernameOf = (email: string) =>
  withSql(
    async (sql) =>
      (
        (await sql`SELECT username FROM users WHERE email = ${email}`)[0] as
          { username: string | null } | undefined
      )?.username ?? null,
  );

describe('AUTH-4.4 / 4.2 sign-in loop through the real handlers', () => {
  test('request → emailed link → confirm → durable session → username → participant access', async () => {
    const { email, response, cookie } = await signUp();
    const sessionRows = await withSql(
      (sql) =>
        sql`SELECT count(*)::int AS c FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
    );
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
        sessionRows: sessionRows[0]?.c,
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
    const sessions = await withSql(
      (sql) =>
        sql`SELECT count(*)::int AS c FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
    );
    assert({
      given: 'the same emailed link redeemed a second time',
      should:
        'set no cookie, create no second session and redirect to the expired view',
      actual: {
        setsCookie: replay.headers.getSetCookie().length,
        sessions: sessions[0]?.c,
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

describe('AUTH-4.2 username claim', () => {
  test('concurrent claims of one name: exactly one 201, all others 409, losers unchanged', async () => {
    // Sign-ups are sequential (the shared mailbox matches mail by arrival
    // order); only the claims race.
    const contenders: Awaited<ReturnType<typeof signUp>>[] = [];
    for (let index = 0; index < 8; index += 1) contenders.push(await signUp());
    const name = uniqueName();
    const responses = await Promise.all(
      contenders.map(({ cookie }) => claim(cookie, { username: name })),
    );
    const statuses = responses.map((response) => response.status).sort();
    const owners = await withSql(
      (sql) => sql`SELECT email FROM users WHERE lower(username) = ${name}`,
    );
    const winnerEmail = owners[0]?.email as string;
    const losers = contenders.filter(({ email }) => email !== winnerEmail);
    const loserNames = await Promise.all(
      losers.map(({ email }) => usernameOf(email)),
    );
    const loserBodies = await Promise.all(
      responses
        .filter((response) => response.status === 409)
        .map(async (response) => (await response.json()).error.code),
    );
    assert({
      given: 'eight verified accounts claiming the same name at once',
      should:
        'grant exactly one 201, return a stable 409 to the rest and leave every loser without a username',
      actual: {
        statuses,
        owners: owners.length,
        loserNames,
        loserCodes: [...new Set(loserBodies)],
      },
      expected: {
        statuses: [201, 409, 409, 409, 409, 409, 409, 409],
        owners: 1,
        loserNames: Array(7).fill(null),
        loserCodes: ['USERNAME_TAKEN'],
      },
    });
  });

  test('names collide regardless of case, and the loser can still choose another', async () => {
    const first = await signUp();
    const second = await signUp();
    const name = uniqueName();
    const won = await claim(first.cookie, { username: name });
    const lost = await claim(second.cookie, { username: name.toUpperCase() });
    const retry = await claim(second.cookie, { username: uniqueName() });
    assert({
      given: 'a second account claiming the same name in capitals',
      should: 'answer 409 and then accept a different name',
      actual: [won.status, lost.status, retry.status],
      expected: [201, 409, 201],
    });
  });

  test('the owner retrying the same name succeeds idempotently; a different name is refused', async () => {
    const { email, cookie } = await signUp();
    const name = uniqueName();
    const first = await claim(cookie, { username: name });
    const again = await claim(cookie, { username: ` ${name.toUpperCase()} ` });
    const other = await claim(cookie, { username: uniqueName() });
    assert({
      given: 'a completed account',
      should:
        'answer 201, then 200 for the same name, then a 409 that changes nothing',
      actual: {
        statuses: [first.status, again.status, other.status],
        code: (await other.json()).error.code,
        stored: await usernameOf(email),
      },
      expected: {
        statuses: [201, 200, 409],
        code: 'USERNAME_ALREADY_SET',
        stored: name,
      },
    });
  });

  test('invalid names, extra fields and forged user ids are refused and change nothing', async () => {
    const { email, cookie } = await signUp();
    const victim = await signUp();
    const forgedVictim = await claim(cookie, {
      username: uniqueName(),
      id: (
        await withSql(
          (sql) => sql`SELECT id FROM users WHERE email = ${victim.email}`,
        )
      )[0]?.id,
    });
    const statuses = await Promise.all(
      [
        { username: 'ab' },
        { username: 'a'.repeat(33) },
        { username: 'has space' },
        { username: 'ünïcode' },
        { username: 42 },
        {},
        { username: uniqueName(), userId: 'someone-else' },
        { username: uniqueName(), role: 'admin' },
        [uniqueName()],
      ].map(async (body) => (await claim(cookie, body)).status),
    );
    assert({
      given: 'malformed bodies and identity fields supplied by the caller',
      should: 'answer 400 and leave both accounts without usernames',
      actual: {
        statuses,
        forgedVictim: forgedVictim.status,
        mine: await usernameOf(email),
        theirs: await usernameOf(victim.email),
      },
      expected: {
        statuses: Array(9).fill(400),
        forgedVictim: 400,
        mine: null,
        theirs: null,
      },
    });
  });

  test('anonymous, cross-origin and cookie-forged callers are refused', async () => {
    const { email, cookie } = await signUp();
    const anonymous = await claim(null, { username: uniqueName() });
    const forged = await claim('better-auth.session_token=forged.value', {
      username: uniqueName(),
    });
    const crossOrigin = await claim(
      cookie,
      { username: uniqueName() },
      { origin: 'https://evil.example' },
    );
    assert({
      given: 'no session, a forged session and a foreign origin',
      should: 'answer 401, 401 and 403 without touching the account',
      actual: {
        statuses: [anonymous.status, forged.status, crossOrigin.status],
        stored: await usernameOf(email),
      },
      expected: { statuses: [401, 401, 403], stored: null },
    });
  });

  test('the general profile update surface is closed', async () => {
    const { email, cookie } = await signUp();
    const update = await authRoute.POST(
      new Request(`${origin}/api/auth/update-user`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          cookie,
          [CLIENT_IP_HEADER]: newClient(),
        },
        body: JSON.stringify({ username: uniqueName(), name: 'Mallory' }),
      }),
    );
    const changeEmail = await authRoute.POST(
      new Request(`${origin}/api/auth/change-email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          cookie,
          [CLIENT_IP_HEADER]: newClient(),
        },
        body: JSON.stringify({ newEmail: 'x@example.test' }),
      }),
    );
    assert({
      given: 'a signed-in account calling Better Auth profile endpoints',
      should: 'answer 404 and leave username and name untouched',
      actual: {
        statuses: [update.status, changeEmail.status],
        stored: await usernameOf(email),
      },
      expected: { statuses: [404, 404], stored: null },
    });
  });

  test('a claim burst is rate limited per account', async () => {
    const { cookie } = await signUp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1)
      statuses.push((await claim(cookie, { username: 'no' })).status);
    assert({
      given: 'twelve rapid claims by one account',
      should: 'answer 400 ten times and then 429',
      actual: [
        statuses.slice(0, 10).every((status) => status === 400),
        statuses.slice(10),
      ],
      expected: [true, [429, 429]],
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
