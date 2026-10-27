import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { loadAuthorizationSession } from '../src/authorization';
import { withFixture, withDatabase } from './constraint-helpers';
import { command, pendingAccount } from './operator-accounts.test-support';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('operator beta access commands (ADR 0079)', () => {
  test('an approval commits state, revision, audit, receipt and the owed mail together', async () => {
    await withFixture(url, async (fixture) => {
      const { userId } = await pendingAccount(fixture);
      const input = command(userId, 'approved', 1);
      const outcome = await withDatabase(url, (database) =>
        database.runBetaAccessCommand(input),
      );
      const [state] =
        await fixture.sql`select state, revision, decided_at is not null as decided from account_beta_access where user_id = ${userId}`;
      const events =
        await fixture.sql`select from_state, to_state, principal, command_id from account_access_events where user_id = ${userId}`;
      const mail =
        await fixture.sql`select purpose, dedupe_key from mail_intents where recipient_user_id = ${userId}`;
      const [receipt] =
        await fixture.sql`select result from operator_command_receipts where command_id = ${input.commandId}`;
      assert({
        given: 'a signed approval of a pending account at its current revision',
        should:
          'commit the change with its audit event, receipt and approval mail',
        actual: {
          outcome,
          state,
          events: [...events],
          mail: [...mail],
          receipt: receipt?.result,
        },
        expected: {
          outcome: {
            kind: 'applied',
            result: {
              commandId: input.commandId,
              outcome: 'changed',
              accessState: 'approved',
              accessRevision: 2,
              mail: 'queued',
            },
          },
          state: { state: 'approved', revision: 2, decided: true },
          events: [
            {
              from_state: 'pending',
              to_state: 'approved',
              principal: `operator:daisy-admin/${'o'.repeat(24)}`,
              command_id: input.commandId,
            },
          ],
          mail: [
            {
              purpose: 'beta-approved',
              dedupe_key: `beta-approved:${input.commandId}`,
            },
          ],
          receipt: outcome.result,
        },
      });
    });
  });

  test('a retry replays, a reused id with another request conflicts, and a stale form conflicts', async () => {
    await withFixture(url, async (fixture) => {
      const { userId } = await pendingAccount(fixture);
      await withDatabase(url, async (database) => {
        const input = command(userId, 'approved', 1);
        await database.runBetaAccessCommand(input);
        const replay = await database.runBetaAccessCommand(input);
        await assertRejects({
          given: 'the same command id with a different request',
          should: 'conflict',
          actual: () =>
            database.runBetaAccessCommand({
              ...input,
              requestDigest: 'b'.repeat(64),
            }),
          code: 'CONFLICT',
        });
        await assertRejects({
          given: 'a revocation against a revision that moved',
          should: 'conflict as stale',
          actual: () =>
            database.runBetaAccessCommand(command(userId, 'revoked', 1)),
          code: 'CONFLICT',
        });
        const noop = await database.runBetaAccessCommand(
          command(userId, 'approved', 2),
        );
        const [events] =
          await fixture.sql`select count(*)::int as n from account_access_events where user_id = ${userId}`;
        assert({
          given:
            'the same command again, a reused id, a stale revocation and a no-op approval',
          should:
            'replay the stored result, refuse both conflicts, and record the no-op without a change',
          actual: [
            replay.kind,
            replay.result.accessRevision,
            noop.result.outcome,
            events?.n,
          ],
          expected: ['replayed', 2, 'unchanged', 1],
        });
      });
    });
  });

  test('a revocation ends live session authority and pushes the socket close', async () => {
    await withFixture(url, async (fixture) => {
      const { userId, actorId, sessionId } = await pendingAccount(fixture);
      await withDatabase(url, async (database) => {
        await database.runBetaAccessCommand(command(userId, 'approved', 1));
        const db = drizzle({ client: fixture.sql });
        const input = {
          sessionId,
          userId,
          actorId,
          now: new Date().toISOString(),
        };
        const before = await loadAuthorizationSession(db, input);
        const revoked = await database.runBetaAccessCommand(
          command(userId, 'revoked', 2),
        );
        const after = await loadAuthorizationSession(db, input);
        const pushes =
          await fixture.sql`select kind from outbox where kind = 'session.revoked' and payload->'ids'->>0 = ${actorId}`;
        await fixture.sql`delete from outbox where kind = 'session.revoked' and payload->'ids'->>0 = ${actorId}`;
        assert({
          given: 'an approved account with a live session, then revoked',
          should:
            'show the revocation on the very next session read and queue the socket close',
          actual: [
            before?.account.beta?.state,
            revoked.result.accessState,
            after?.account.beta?.state,
            pushes.length,
          ],
          expected: ['approved', 'revoked', 'revoked', 1],
        });
      });
    });
  });

  test('concurrent approve and revoke serialize on the account fence', async () => {
    await withFixture(url, async (fixture) => {
      const { userId } = await pendingAccount(fixture);
      await withDatabase(url, async (database) => {
        const outcomes = await Promise.allSettled([
          database.runBetaAccessCommand(command(userId, 'approved', 1)),
          database.runBetaAccessCommand(command(userId, 'revoked', 1)),
        ]);
        const [row] =
          await fixture.sql`select revision from account_beta_access where user_id = ${userId}`;
        assert({
          given: 'an approval and a revocation racing from the same revision',
          should: 'apply exactly one and refuse the other as stale',
          actual: [
            outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
            row?.revision,
          ],
          expected: [1, 2],
        });
      });
    });
  });

  test('an account without a durable 16+ age record is not approved (ISSUE-664)', async () => {
    await withFixture(url, async (fixture) => {
      const { userId } = await pendingAccount(fixture);
      await fixture.sql`delete from account_age where user_id = ${userId}`;
      await withDatabase(url, async (database) => {
        await assertRejects({
          given: 'an approval for a pending account with no age record',
          should: 'refuse as an invariant and change nothing',
          actual: () =>
            database.runBetaAccessCommand(command(userId, 'approved', 1)),
          code: 'INVARIANT',
        });
      });
      const [state] =
        await fixture.sql`select state, revision from account_beta_access where user_id = ${userId}`;
      assert({
        given: 'the refused approval',
        should: 'leave the account pending at its revision',
        actual: state,
        expected: { state: 'pending', revision: 1 },
      });
    });
  });

  test('an unknown, erased or refused target changes nothing', async () => {
    await withFixture(url, async (fixture) => {
      const { userId } = await pendingAccount(fixture);
      await withDatabase(url, async (database) => {
        await assertRejects({
          given: 'a command for an account that does not exist',
          should: 'answer not found',
          actual: () =>
            database.runBetaAccessCommand(command(createId(), 'approved', 1)),
          code: 'NOT_FOUND',
        });
        await assertRejects({
          given: 'a command the operator service may not issue',
          should: 'be refused without a change',
          actual: () =>
            database.runBetaAccessCommand(
              command(userId, 'approved', 1, { authorize: () => false }),
            ),
          code: 'AUTHORIZATION',
        });
      });
      const [state] =
        await fixture.sql`select state, revision from account_beta_access where user_id = ${userId}`;
      assert({
        given: 'both refused commands',
        should: 'leave the account pending at its revision',
        actual: state,
        expected: { state: 'pending', revision: 1 },
      });
    });
  });

  test('accounts list newest first in stable keyset pages', async () => {
    await withFixture(url, async (fixture) => {
      const accounts: string[] = [];
      for (const minute of [1, 2, 3]) {
        const { userId } = await pendingAccount(fixture);
        await fixture.sql`update account_beta_access set requested_at = ${`2001-01-01T00:0${minute}:00.000Z`}::timestamptz where user_id = ${userId}`;
        accounts.push(userId);
      }
      await withDatabase(url, async (database) => {
        const first = await database.listOperatorAccounts({
          access: 'pending',
          limit: 2,
          after: {
            requestedAt: '2001-01-01T00:04:00.000Z',
            userId: 'z'.repeat(24),
          },
        });
        const last = first.at(-1)!;
        const second = await database.listOperatorAccounts({
          access: 'pending',
          limit: 2,
          after: { requestedAt: last.requestedAt, userId: last.userId },
        });
        assert({
          given: 'three pending accounts requested a minute apart',
          should: 'page newest first with no overlap',
          actual: [
            first.map((row) => row.userId),
            second
              .filter((row) => accounts.includes(row.userId))
              .map((row) => row.userId),
          ],
          expected: [[accounts[2], accounts[1]], [accounts[0]]],
        });
      });
    });
  });
});
