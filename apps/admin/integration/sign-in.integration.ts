import { requireTestServices } from '@daisy/config';
import { asc } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ATTEMPT_LIMIT } from '../src/auth/rate-limit';
import { beginSignIn, finishSignIn } from '../src/auth/sign-in';
import { auditEvents, operatorSessions } from '../src/db/schema';
import {
  address,
  assertion,
  enrolledOwner,
  testDeps,
  suiteDatabase,
} from './admin.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

const lastKinds = async (count: number) =>
  (await db.select().from(auditEvents).orderBy(asc(auditEvents.seq)))
    .slice(-count)
    .map(({ kind, detail }) => `${kind}:${detail ?? ''}`);

test('sign-in rotates the session', async () => {
  const deps = testDeps(db);
  const device = await enrolledOwner(deps, 11);
  const first = await finishSignIn(deps, {
    address,
    presented: null,
    response: await assertion(deps, device, 1),
  });
  const second = await finishSignIn(deps, {
    address,
    presented: first.ok ? first.sessionToken : null,
    response: await assertion(deps, device, 2),
  });
  const sessions = await db
    .select()
    .from(operatorSessions)
    .orderBy(asc(operatorSessions.createdAt));
  assert({
    given: 'a sign-in that presents the previous session',
    should: 'issue a new token and revoke the presented session',
    actual: [
      first.ok && second.ok && first.sessionToken !== second.sessionToken,
      sessions.map(({ revokedAt }) => revokedAt === null).sort(),
      await lastKinds(2),
    ],
    expected: [
      true,
      [false, true],
      ['session.revoked:rotated', 'auth.success:'],
    ],
  });
});

test('a sign-in challenge is single-use', async () => {
  const deps = testDeps(db);
  const device = await enrolledOwner(deps, 12);
  const response = await assertion(deps, device, 1);
  const [one, two] = await Promise.all([
    finishSignIn(deps, { address, presented: null, response }),
    finishSignIn(deps, { address, presented: null, response }),
  ]);
  const replay = await finishSignIn(deps, {
    address,
    presented: null,
    response,
  });
  assert({
    given: 'one assertion submitted twice at once and then replayed',
    should: 'sign in exactly once',
    actual: [[one.ok, two.ok].filter(Boolean).length, replay],
    expected: [1, { ok: false, code: 'AUTHENTICATION' }],
  });
});

test('the sign counter', async () => {
  const deps = testDeps(db);
  const bound = await enrolledOwner(deps, 13);
  await finishSignIn(deps, {
    address,
    presented: null,
    response: await assertion(deps, bound, 5),
  });
  const backwards = await finishSignIn(deps, {
    address,
    presented: null,
    response: await assertion(deps, bound, 4),
  });
  assert({
    given: 'a device-bound passkey whose counter went backwards',
    should: 'refuse and audit the regression',
    actual: [backwards.ok, await lastKinds(1)],
    expected: [false, ['auth.failure:counter_regressed']],
  });
});

test('racing assertions from a cloned device-bound key', async () => {
  const deps = testDeps(db);
  const bound = await enrolledOwner(deps, 16);
  const responses = [
    await assertion(deps, bound, 7),
    await assertion(deps, bound, 7),
  ];
  const results = await Promise.all(
    responses.map((response) =>
      finishSignIn(deps, { address, presented: null, response }),
    ),
  );
  assert({
    given: 'two assertions carrying the same counter, verified at once',
    should: 'sign in once and refuse the other as a regression',
    actual: [
      results.filter(({ ok }) => ok).length,
      (await lastKinds(2)).sort(),
    ],
    expected: [1, ['auth.failure:counter_regressed', 'auth.success:']],
  });
});

test('racing failures cannot pass the limit', async () => {
  const deps = testDeps(db);
  const device = await enrolledOwner(deps, 17);
  const bogus = async () =>
    finishSignIn(deps, {
      address,
      presented: null,
      response: await device.assert('bogus-challenge', deps.ceremony, 1),
    });
  for (let failure = 1; failure < ATTEMPT_LIMIT; failure += 1) await bogus();
  const racing = await Promise.all([1, 2, 3, 4, 5].map(bogus));
  assert({
    given: 'one failure left in the window and five failures at once',
    should: 'let exactly one through to fail and refuse the rest as limited',
    actual: racing.map((result) => (result.ok ? 'ok' : result.code)).sort(),
    expected: [
      'AUTHENTICATION',
      'RATE_LIMIT',
      'RATE_LIMIT',
      'RATE_LIMIT',
      'RATE_LIMIT',
    ],
  });
});

test('a synced passkey may report a zero counter', async () => {
  const deps = testDeps(db);
  const synced = await enrolledOwner(deps, 14, { backedUp: true });
  const results = [];
  for (const counter of [3, 0])
    results.push(
      (
        await finishSignIn(deps, {
          address,
          presented: null,
          response: await assertion(deps, synced, counter),
        })
      ).ok,
    );
  assert({
    given: 'a backed-up passkey whose counter goes from 3 to 0',
    should: 'sign in both times',
    actual: results,
    expected: [true, true],
  });
});

test('the rate limit trips', async () => {
  const deps = testDeps(db);
  const device = await enrolledOwner(deps, 15);
  for (let failure = 0; failure < ATTEMPT_LIMIT; failure += 1)
    await finishSignIn(deps, {
      address,
      presented: null,
      response: await device.assert('bogus-challenge', deps.ceremony, 1),
    });
  const crossed = await lastKinds(2);
  const audited = (await db.select().from(auditEvents)).length;
  const blocked = await Promise.all(
    [1, 2, 3].map(() => beginSignIn(deps, { address })),
  );
  const unchanged = (await db.select().from(auditEvents)).length === audited;
  const elsewhere = await beginSignIn(deps, { address: '198.51.100.4' });
  deps.advance(10 * 60_000);
  const later = await beginSignIn(deps, { address });
  assert({
    given: 'ten failed sign-ins from one client',
    should:
      'refuse that client for the rest of the window, and no other client',
    actual: [blocked[0], elsewhere.ok, later.ok],
    expected: [{ ok: false, code: 'RATE_LIMIT' }, true, true],
  });
  assert({
    given: 'the failure that exhausts the window, then more blocked requests',
    should: 'audit the limit once, at the crossing, and nothing after it',
    actual: [crossed, unchanged],
    expected: [
      ['auth.failure:challenge_invalid', 'auth.failure:rate_limited'],
      true,
    ],
  });
});
