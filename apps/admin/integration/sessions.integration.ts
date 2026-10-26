import { requireTestServices } from '@daisy/config';
import { afterAll, beforeEach } from 'bun:test';
import { asc } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../src/auth/lifetimes';
import { resolveSession, signOut } from '../src/auth/session';
import { finishSignIn } from '../src/auth/sign-in';
import { auditEvents, operators } from '../src/db/schema';
import {
  address,
  adminTestDatabase,
  assertion,
  enrolledOwner,
  testDeps,
} from './admin.test-support';

requireTestServices(process.env);
setupRitewayBun();
const database = adminTestDatabase();
const { db } = database;
beforeEach(async () => {
  await database.reset();
});
afterAll(() => database.close());

const signedIn = async (deps: ReturnType<typeof testDeps>, seed: number) => {
  const device = await enrolledOwner(deps, seed);
  const result = await finishSignIn(deps, {
    address,
    presented: null,
    response: await assertion(deps, device, 1),
  });
  if (!result.ok) throw new Error('sign-in refused');
  return result.sessionToken;
};
const lastKind = async () =>
  (await db.select().from(auditEvents).orderBy(asc(auditEvents.seq)))
    .slice(-1)
    .map(({ kind, detail }) => `${kind}:${detail ?? ''}`);

test('the idle limit', async () => {
  const deps = testDeps(db);
  const token = await signedIn(deps, 21);
  deps.advance(SESSION_IDLE_MS - 1);
  const busy = await resolveSession(deps, token);
  deps.advance(SESSION_IDLE_MS);
  const idle = await resolveSession(deps, token);
  assert({
    given: 'a request just inside the idle limit, then one 30 minutes later',
    should: 'serve the first, which renews it, and revoke on the second',
    actual: [busy?.displayName, idle, await lastKind()],
    expected: ['owner', null, ['session.revoked:session_idle']],
  });
});

test('the absolute limit', async () => {
  const deps = testDeps(db);
  const token = await signedIn(deps, 22);
  const steps = SESSION_ABSOLUTE_MS / (SESSION_IDLE_MS / 2);
  let alive = 0;
  for (let step = 0; step < steps; step += 1) {
    deps.advance(SESSION_IDLE_MS / 2);
    if (await resolveSession(deps, token)) alive += 1;
  }
  assert({
    given: 'a session used every 15 minutes',
    should: 'die at 12 hours however busy it is',
    actual: [alive, steps - 1, await lastKind()],
    expected: [steps - 1, alive, ['session.revoked:session_expired']],
  });
});

test('a disabled operator', async () => {
  const deps = testDeps(db);
  const token = await signedIn(deps, 23);
  const before = await resolveSession(deps, token);
  await db.update(operators).set({ disabledAt: new Date(deps.clock.now()) });
  const after = await resolveSession(deps, token);
  assert({
    given: 'an operator disabled while signed in',
    should: 'lose the session on the next request',
    actual: [before?.role, after, await lastKind()],
    expected: ['owner', null, ['session.revoked:operator_disabled']],
  });
});

test('sign-out', async () => {
  const deps = testDeps(db);
  const token = await signedIn(deps, 24);
  await signOut(deps, token);
  assert({
    given: 'a signed-out session',
    should: 'no longer resolve',
    actual: [await resolveSession(deps, token), await lastKind()],
    expected: [null, ['session.revoked:signed_out']],
  });
});
