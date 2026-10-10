import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  loadAuthorizationSession,
  type AuthorizationTransaction,
} from './authorization';
import { assertRejects } from '@daisy/errors/testing';
import { authorizationSessionOperations } from './authorization-session';
setupRitewayBun();
test('session authorization binds durable session, user, actor, erasure and expiry', async () => {
  const userId = 'a'.repeat(24),
    actorId = 'b'.repeat(24),
    sessionId = 'c'.repeat(24);
  const account = { userId, actorId, member: true, erased: false, revision: 1 };
  const session = { userId, expiresAt: new Date('2026-10-09T00:01:00.000Z') };
  const cases = [
    { session, account },
    { session: undefined, account },
    { session: { ...session, userId: 'foreign' }, account },
    {
      session: { ...session, expiresAt: new Date('2026-10-09T00:00:00.000Z') },
      account,
    },
    {
      session,
      account: { ...account, erased: true, member: false, revision: 2 },
    },
    { session, account: { ...account, actorId: 'foreign' } },
    { session, account: { ...account, member: false } },
  ];
  const results = await Promise.all(
    cases.map(async (row) => {
      const input = {
        userId,
        actorId,
        sessionId,
        now: '2026-10-09T00:00:00.000Z',
      };
      const transaction = (fenced: boolean) => {
        let reads = fenced ? -1 : 0;
        return {
          execute: async () =>
            reads++ === 0 ? (row.session ? [row.session] : []) : [row.account],
        } as unknown as AuthorizationTransaction;
      };
      const explicit = await loadAuthorizationSession(
        transaction(false),
        input,
      );
      const reader = authorizationSessionOperations({
        database: {
          transaction: async (
            work: (tx: AuthorizationTransaction) => Promise<unknown>,
          ) => work(transaction(true)),
        } as unknown as Parameters<
          typeof authorizationSessionOperations
        >[0]['database'],
      });
      const resolved = await reader.resolveRealtimeSession({
        sessionId,
        actorId,
        now: input.now,
      });
      return [explicit !== null, resolved !== null];
    }),
  );
  assert({
    given:
      'current, missing, mismatched, expired, erased, foreign actor and provisional rows',
    should: 'accept only the current exact bound session',
    actual: results,
    expected: [
      [true, true],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
    ],
  });
});

test('pool-bound session reader validates every identity before opening a transaction', async () => {
  let calls = 0;
  const reader = authorizationSessionOperations({
    database: {
      transaction: async () => {
        calls++;
        return null;
      },
    } as unknown as Parameters<
      typeof authorizationSessionOperations
    >[0]['database'],
  });
  await assertRejects({
    given: 'an invalid session binding with a valid actor',
    should: 'reject before pool I/O',
    actual: () =>
      reader.readAuthorizationSession({
        sessionId: 'invalid',
        userId: 'a'.repeat(24),
        actorId: 'b'.repeat(24),
        now: '2026-10-09T00:00:00.000Z',
      }),
    code: 'VALIDATION',
  });
  assert({
    given: 'the rejected boundary input',
    should: 'leave the pool untouched',
    actual: calls,
    expected: 0,
  });
});
