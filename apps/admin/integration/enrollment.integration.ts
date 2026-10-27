import { requireTestServices } from '@daisy/config';
import { asc } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { beginEnrollment, finishEnrollment } from '../src/auth/enrollment';
import { issueEnrollment } from '../src/auth/issue-enrollment';
import { CHALLENGE_TTL_MS, enrollmentExpiry } from '../src/auth/lifetimes';
import { mintSecret, sha3 } from '../src/auth/secrets';
import { softAuthenticator } from '../src/auth/soft-authenticator.test-support';
import { beginSignIn, finishSignIn } from '../src/auth/sign-in';
import {
  auditEvents,
  operatorCredentials,
  operatorEnrollments,
  operators,
  operatorSessions,
} from '../src/db/schema';
import {
  address,
  enrollmentToken,
  registration,
  testDeps,
  suiteDatabase,
} from './admin.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

const register = (
  deps: ReturnType<typeof testDeps>,
  token: string,
  seed: number,
) => registration(deps, token, seed);

const kinds = async () =>
  (await db.select().from(auditEvents).orderBy(asc(auditEvents.seq))).map(
    ({ kind, detail }) => `${kind}:${detail ?? ''}`,
  );

test('the bootstrap CLI', async () => {
  const deps = testDeps(db);
  const first = await enrollmentToken(deps);
  const again = await issueEnrollment(deps, {
    name: 'second',
    mode: 'initial',
  });
  const additional = await enrollmentToken(deps, 'owner', 'additional');
  const rows = await db.select().from(operatorEnrollments);
  assert({
    given: 'a first owner, a second owner and an additional link',
    should:
      'refuse the second owner, revoke the earlier link and audit each issue',
    actual: [
      again,
      rows.filter((row) => row.revokedAt !== null).length,
      first === additional,
      await kinds(),
    ],
    expected: [
      {
        ok: false,
        reason:
          'An owner already exists; use --additional or --replace for that operator',
      },
      1,
      false,
      ['enrollment.issued:initial', 'enrollment.issued:additional'],
    ],
  });
});

test('enrollment is single-use', async () => {
  const deps = testDeps(db);
  const token = await enrollmentToken(deps);
  const begun = await beginEnrollment(deps, { token, address });
  const [open] = await db.select().from(operatorEnrollments);
  const { response } = await register(deps, token, 1);
  const [first, second] = await Promise.all([
    finishEnrollment(deps, { token, address, response }),
    finishEnrollment(deps, { token, address, response }),
  ]);
  const later = await register(deps, token, 2).catch(() => 'refused');
  assert({
    given: 'a page render and a register challenge',
    should: 'consume nothing',
    actual: [begun.ok, open?.consumedAt],
    expected: [true, null],
  });
  assert({
    given: 'two parallel finishes of one enrollment',
    should: 'succeed exactly once and store one credential',
    actual: [
      [first.ok, second.ok].filter(Boolean).length,
      (await db.select().from(operatorCredentials)).length,
      later,
    ],
    expected: [1, 1, 'refused'],
  });
});

test('register challenges are bound', async () => {
  const deps = testDeps(db);
  const owner = await enrollmentToken(deps);
  const { response } = await register(deps, owner, 3);
  // A second operator's open enrollment, written as the owner would.
  const otherToken = mintSecret(deps.random);
  await db.insert(operators).values({
    id: 'operator2operator2operat',
    displayName: 'second',
    role: 'operator',
    createdAt: new Date(deps.clock.now()),
  });
  await db.insert(operatorEnrollments).values({
    id: 'enrollment2enrollment2en',
    operatorId: 'operator2operator2operat',
    tokenHash: sha3(otherToken),
    mode: 'initial',
    createdAt: new Date(deps.clock.now()),
    expiresAt: new Date(enrollmentExpiry(deps.clock.now())),
  });
  const crossed = await finishEnrollment(deps, {
    token: otherToken,
    address,
    response,
  });
  const signIn = await beginSignIn(deps, { address });
  const device = await softAuthenticator(5);
  const asRegister = signIn.ok
    ? await finishEnrollment(deps, {
        token: owner,
        address,
        response: await device.register(
          signIn.options.challenge,
          deps.ceremony,
        ),
      })
    : signIn;
  deps.advance(CHALLENGE_TTL_MS);
  const expired = await finishEnrollment(deps, {
    token: owner,
    address,
    response,
  });
  assert({
    given:
      'a challenge bound to another enrollment, a sign-in challenge, and an expired one',
    should: 'refuse each without consuming either enrollment',
    actual: [
      crossed.ok,
      asRegister.ok,
      expired.ok,
      (await db.select().from(operatorEnrollments)).map(
        ({ consumedAt }) => consumedAt,
      ),
    ],
    expected: [false, false, false, [null, null]],
  });
});

test('--replace revokes the earlier passkeys and sessions', async () => {
  const deps = testDeps(db);
  const token = await enrollmentToken(deps);
  const lost = await register(deps, token, 6);
  await finishEnrollment(deps, { token, address, response: lost.response });
  const begun = await beginSignIn(deps, { address });
  if (!begun.ok) throw new Error('beginSignIn refused');
  const signedIn = await finishSignIn(deps, {
    address,
    presented: null,
    response: await lost.device.assert(
      begun.options.challenge,
      deps.ceremony,
      1,
    ),
  });
  const replace = await enrollmentToken(deps, 'owner', 'replace');
  const fresh = await register(deps, replace, 7);
  const replaced = await finishEnrollment(deps, {
    token: replace,
    address,
    response: fresh.response,
  });
  const credentials = await db
    .select()
    .from(operatorCredentials)
    .orderBy(asc(operatorCredentials.credentialId));
  const sessions = await db.select().from(operatorSessions);
  assert({
    given: 'a lost passkey replaced through a --replace link',
    should: 'keep only the new credential and end every session',
    actual: [
      signedIn.ok,
      replaced.ok,
      credentials.map(({ credentialId, revokedAt }) => [
        credentialId,
        revokedAt === null,
      ]),
      sessions.map(({ revokedAt }) => revokedAt !== null),
      (await kinds()).slice(-3),
    ],
    expected: [
      true,
      true,
      [
        [lost.device.id, false],
        [fresh.device.id, true],
      ],
      [true],
      [
        'credential.revoked:replaced',
        'session.revoked:replaced',
        'operator.enrolled:replace',
      ],
    ],
  });
});

test('a credential without user verification or on another origin', async () => {
  const deps = testDeps(db);
  const token = await enrollmentToken(deps);
  const begun = await beginEnrollment(deps, { token, address });
  if (!begun.ok) throw new Error('beginEnrollment refused');
  const device = await softAuthenticator(8);
  const unverified = await finishEnrollment(deps, {
    token,
    address,
    response: await device.register(begun.options.challenge, deps.ceremony, {
      userVerified: false,
    }),
  });
  const elsewhere = await finishEnrollment(deps, {
    token,
    address,
    response: await device.register(begun.options.challenge, {
      origin: 'http://127.0.0.1:4800',
      rpId: 'localhost',
    }),
  });
  assert({
    given: 'an attestation without UV, and one from a non-canonical origin',
    should: 'refuse both and leave the enrollment open',
    actual: [
      unverified,
      elsewhere.ok,
      (await db.select().from(operatorCredentials)).length,
      (await kinds()).slice(-2),
    ],
    expected: [
      { ok: false, code: 'AUTHENTICATION' },
      false,
      0,
      ['auth.failure:verification_failed', 'auth.failure:verification_failed'],
    ],
  });
});
