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

  test('a command reads back by action, its owner adding the owed mail (ISSUE-781)', async () => {
    await withFixture(url, async (fixture) => {
      const { userId } = await pendingAccount(fixture);
      const approval = command(userId, 'approved', 1);
      const read = await withDatabase(url, async (database) => {
        const outcome = await database.runBetaAccessCommand(approval);
        return {
          outcome,
          own: await database.readOperatorCommand({
            commandId: approval.commandId,
            serviceId: approval.serviceId,
          }),
          other: await database.readOperatorCommand({
            commandId: approval.commandId,
            serviceId: 'another-service',
          }),
        };
      });
      assert({
        given:
          'an applied approval read back by its own and by another service',
        should:
          'return the beta access variant with its queued approval mail to the issuer only',
        actual: [read.own, read.other],
        expected: [
          {
            action: 'account.beta_access.update',
            result: read.outcome.result,
            mailState: 'queued',
          },
          null,
        ],
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

  test('one command id reused concurrently for two targets answers a conflict, not a key error (ISSUE-682)', async () => {
    await withFixture(url, async (fixture) => {
      const first = await pendingAccount(fixture);
      const second = await pendingAccount(fixture);
      const commandId = createId();
      await withDatabase(url, async (database) => {
        const outcomes = await Promise.allSettled(
          [first.userId, second.userId].map((userId) =>
            database.runBetaAccessCommand(
              command(userId, 'approved', 1, { commandId }),
            ),
          ),
        );
        assert({
          given:
            'two concurrent approvals sharing one command id, each for another account',
          should: 'apply exactly one and answer CONFLICT to the other',
          actual: outcomes
            .map((outcome) =>
              outcome.status === 'fulfilled'
                ? 'applied'
                : (outcome.reason as { code?: string }).code,
            )
            .sort(),
          expected: ['CONFLICT', 'applied'],
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
        const erased = await pendingAccount(fixture);
        await fixture.sql`update users set username = null, email = null, deleted_at = now(), version = version + 1 where id = ${erased.userId}`;
        await assertRejects({
          given: 'a command for an erased account (ISSUE-684)',
          should: 'answer not found, as for an unknown one',
          actual: () =>
            database.runBetaAccessCommand(
              command(erased.userId, 'approved', 1),
            ),
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
});
