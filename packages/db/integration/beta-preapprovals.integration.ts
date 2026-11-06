import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { PreapprovalCommand } from '@daisy/protocol/beta-preapproval';
import { createDatabase } from '../src';
import { withFixture, type Fixture } from './constraint-helpers';
import {
  pendingAccount,
  command as accessCommand,
} from './operator-accounts.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const inputFor = (command: PreapprovalCommand, live = () => true) => ({
  command,
  serviceId: 'daisy-admin',
  operatorRef: 'o'.repeat(24),
  requestDigest: createHash('sha3-256')
    .update(JSON.stringify(command))
    .digest('hex'),
  nextId: createId,
  live,
});
/** Tracks exactly this test's durable command and recipient records. */
const trackedDatabase = (
  f: Fixture,
  options: Parameters<typeof createDatabase>[0],
) => {
  const db = createDatabase(options);
  const commandIds: string[] = [];
  const grants: string[] = [];
  return {
    ...db,
    runPreapprovalCommand: async (
      input: Parameters<typeof db.runPreapprovalCommand>[0],
    ) => {
      commandIds.push(input.command.commandId);
      const result = await db.runPreapprovalCommand(input);
      grants.push(result.preapprovalId);
      return result;
    },
    close: async () => {
      for (const id of commandIds) {
        await f.sql`delete from mail_intents where dedupe_key = ${`beta-invitation:${id}`}`;
        await f.sql`delete from operator_command_receipts where command_id = ${id}`;
      }
      for (const id of grants)
        await f.sql`delete from beta_preapprovals where id = ${id}`;
      await db.close();
    },
  };
};
const add = (email: string, invite = false): PreapprovalCommand => ({
  v: 1,
  commandId: createId(),
  adminAuditHead: 'a'.repeat(64),
  operation: 'add',
  email,
  invite,
});
const access = async (f: Fixture, userId: string) => {
  const [row] =
    await f.sql`select state from account_beta_access where user_id = ${userId}`;
  return row?.state;
};
const grant = async (f: Fixture, id: string) => {
  const [row] =
    await f.sql`select claimed_by, revision from beta_preapprovals where id = ${id}`;
  return row;
};

describe('beta email grants through participant operations', () => {
  test('duplicate grants, immediate approval and command replay owe one invitation', async () => {
    await withFixture(url, async (f) => {
      const account = await pendingAccount(f);
      const db = trackedDatabase(f, { url, nextActorId: createId });
      const email = `${account.userId}@operator.invalid`;
      try {
        const input = inputFor(add(email, true));
        const results = await Promise.all([
          db.runPreapprovalCommand(input),
          db.runPreapprovalCommand(input),
          db.runPreapprovalCommand(inputFor(add(email, true))),
        ]);
        const id = results[0]!.preapprovalId;
        const [count] =
          await f.sql`select count(*)::int as count from mail_intents where preapproval_id = ${id}`;
        const [approvalMail] =
          await f.sql`select count(*)::int as count from mail_intents where recipient_user_id = ${account.userId}`;
        assert({
          given:
            'an existing eligible waiting account, concurrent duplicate additions and receipt replay',
          should: 'approve once and owe one invitation with no approval email',
          actual: [
            results.every((r) => r.preapprovalId === id),
            await access(f, account.userId),
            (await grant(f, id)).claimed_by,
            count.count,
            approvalMail.count,
          ],
          expected: [true, 'approved', account.userId, 1, 0],
        });
        const [invitation] =
          await f.sql`select id from mail_intents where preapproval_id = ${id}`;
        const removed = await db.runPreapprovalCommand(
          inputFor({
            v: 1,
            commandId: createId(),
            adminAuditHead: 'a'.repeat(64),
            operation: 'remove',
            preapprovalId: id,
            expectedRevision: (await grant(f, id)).revision,
          }),
        );
        const [mail] =
          await f.sql`select state from mail_intents where id = ${invitation.id}`;
        assert({
          given: 'removal after a claim',
          should: 'cancel owed invitation and preserve approved account access',
          actual: [
            removed.outcome,
            await access(f, account.userId),
            mail.state,
          ],
          expected: ['removed', 'approved', 'cancelled'],
        });
      } finally {
        await db.close();
      }
    });
  });

  test('signup consumes only a matching verified eligible grant', async () => {
    await withFixture(url, async (f) => {
      const db = trackedDatabase(f, { url, nextActorId: createId });
      const userId = createId();
      const email = `${userId}+beta@example.test`;
      await f.insert('users', {
        id: userId,
        username: null,
        email: `  ${email.toUpperCase()} `,
        email_verified: true,
      });
      await f.sql`insert into account_age (user_id, birth_month, recorded_at) values (${userId}, '2000-01', now())`;
      try {
        const saved = await db.runPreapprovalCommand(inputFor(add(email)));
        await db.claimUsername({ userId, username: `i-${userId}` });
        const [actor] =
          await f.sql`select id from actors where user_id = ${userId}`;
        f.track('actors', actor.id);
        assert({
          given:
            'a silently preapproved email and its verified adult signup with mixed case and spaces',
          should: 'claim the grant once without invitation or approval mail',
          actual: [
            await access(f, userId),
            (await grant(f, saved.preapprovalId)).claimed_by,
          ],
          expected: ['approved', userId],
        });
      } finally {
        await db.close();
      }
    });
  });

  test('missing age defers a claim, revoked access never restores', async () => {
    await withFixture(url, async (f) => {
      const account = await pendingAccount(f);
      const db = trackedDatabase(f, { url, nextActorId: createId });
      await f.sql`delete from account_age where user_id = ${account.userId}`;
      try {
        const result = await db.runPreapprovalCommand(
          inputFor(add(`${account.userId}@operator.invalid`)),
        );
        assert({
          given: 'a pending account without age evidence',
          should: 'leave its grant unclaimed',
          actual: [
            await access(f, account.userId),
            (await grant(f, result.preapprovalId)).claimed_by,
          ],
          expected: ['pending', null],
        });
        await db.recordAgeStep({
          userId: account.userId,
          birthMonth: '2000-01',
          termsVersion: 'test',
          now: '2026-11-06T20:00:00.000Z',
        });
        assert({
          given: 'the required age and Terms step completed',
          should: 'consume the available grant',
          actual: await access(f, account.userId),
          expected: 'approved',
        });
        await db.runBetaAccessCommand(
          accessCommand(account.userId, 'revoked', 2),
        );
        await db.runPreapprovalCommand(
          inputFor(add(`${account.userId}@operator.invalid`)),
        );
        assert({
          given: 'a revoked account and a repeated preapproval',
          should: 'keep revocation authoritative',
          actual: await access(f, account.userId),
          expected: 'revoked',
        });
      } finally {
        await db.close();
      }
    });
  });

  test('expired commands roll back all grant and mail writes', async () => {
    await withFixture(url, async (f) => {
      const db = trackedDatabase(f, { url, nextActorId: createId });
      const command = add(`${createId()}@example.test`, true);
      try {
        let refused = false;
        try {
          await db.runPreapprovalCommand(inputFor(command, () => false));
        } catch {
          refused = true;
        }
        const [row] =
          await f.sql`select count(*)::int as count from beta_preapprovals where email = ${(command as Extract<PreapprovalCommand, { operation: 'add' }>).email}`;
        const [receipt] =
          await f.sql`select count(*)::int as count from operator_command_receipts where command_id = ${command.commandId}`;
        const [mail] =
          await f.sql`select count(*)::int as count from mail_intents where dedupe_key = ${`beta-invitation:${command.commandId}`}`;
        assert({
          given: 'a command whose deadline expires before commit',
          should: 'atomically leave no grant, receipt or mail intent',
          actual: [refused, row.count, receipt.count, mail.count],
          expected: [true, 0, 0, 0],
        });
      } finally {
        await db.close();
      }
    });
  });
});

test('two verified accounts racing one grant can consume it only once', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const email = `${createId()}@example.test`;
    const userIds = [createId(), createId()];
    try {
      const saved = await db.runPreapprovalCommand(inputFor(add(email)));
      for (const [index, userId] of userIds.entries()) {
        await f.insert('users', {
          id: userId,
          username: null,
          email: index === 0 ? email : email.toUpperCase(),
          email_verified: true,
        });
        await f.sql`insert into account_age (user_id, birth_month, recorded_at) values (${userId}, '2000-01', now())`;
      }
      await Promise.all(
        userIds.map((userId) =>
          db.claimUsername({ userId, username: `i-${userId}` }),
        ),
      );
      for (const userId of userIds) {
        const [actor] =
          await f.sql`select id from actors where user_id = ${userId}`;
        f.track('actors', actor.id);
      }
      const states = await Promise.all(
        userIds.map((userId) => access(f, userId)),
      );
      assert({
        given:
          'two verified adult accounts with the same normalized email racing signup',
        should:
          'grant approval to exactly one account and retain its one-time claim',
        actual: [
          states.sort(),
          userIds.includes((await grant(f, saved.preapprovalId)).claimed_by),
        ],
        expected: [['approved', 'pending'], true],
      });
    } finally {
      await db.close();
    }
  });
});

test('signup and removal serialize without an orphaned approval', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const userId = createId();
    const email = `${userId}@example.test`;
    await f.insert('users', {
      id: userId,
      username: null,
      email,
      email_verified: true,
    });
    await f.sql`insert into account_age (user_id, birth_month, recorded_at) values (${userId}, '2000-01', now())`;
    try {
      const saved = await db.runPreapprovalCommand(inputFor(add(email)));
      const [signup, removal] = await Promise.allSettled([
        db.claimUsername({ userId, username: `i-${userId}` }),
        db.runPreapprovalCommand(
          inputFor({
            v: 1,
            commandId: createId(),
            adminAuditHead: 'a'.repeat(64),
            operation: 'remove',
            preapprovalId: saved.preapprovalId,
            expectedRevision: 1,
          }),
        ),
      ]);
      const [actor] =
        await f.sql`select id from actors where user_id = ${userId}`;
      f.track('actors', actor.id);
      const current = await grant(f, saved.preapprovalId);
      const state = await access(f, userId);
      assert({
        given: 'a signup racing removal of its unused grant',
        should:
          'either remove first and leave pending, or claim first and refuse the stale removal',
        actual:
          signup.status === 'fulfilled' &&
          ((removal.status === 'fulfilled' &&
            current === undefined &&
            state === 'pending') ||
            (removal.status === 'rejected' &&
              current?.claimed_by === userId &&
              state === 'approved')),
        expected: true,
      });
    } finally {
      await db.close();
    }
  });
});

test('an invitation lease recovers a crashed send under one provider identity', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const command = add(`${createId()}@example.test`, true);
    try {
      await db.runPreapprovalCommand(inputFor(command));
      const [intent] =
        await f.sql`select id from mail_intents where dedupe_key = ${`beta-invitation:${command.commandId}`}`;
      const claims = await db.claimMailIntents({
        limit: 50,
        leaseMs: 60000,
        nextToken: () => `${createId()}${createId()}`,
      });
      const first = claims.find((claim) => claim.id === intent.id)!;
      const before = await db.readOperatorCommand({
        commandId: command.commandId,
        serviceId: 'daisy-admin',
      });
      await f.sql`update mail_intents set lease_expires_at = now() - interval '1 minute' where id = ${intent.id}`;
      const retried = await db.claimMailIntents({
        limit: 50,
        leaseMs: 60000,
        nextToken: () => `${createId()}${createId()}`,
      });
      const second = retried.find((claim) => claim.id === intent.id)!;
      const stale = await db.settleMailIntent({
        id: first.id,
        token: first.token,
        outcome: { kind: 'sent' },
      });
      await db.settleMailIntent({
        id: second.id,
        token: second.token,
        outcome: { kind: 'cancelled', errorCode: 'suppressed' },
      });
      const after = await db.readOperatorCommand({
        commandId: command.commandId,
        serviceId: 'daisy-admin',
      });
      assert({
        given:
          'an invitation whose worker crashes before settlement, then a suppression',
        should:
          'retain one intent/provider id, reject the old lease and show honest unknown then suppressed states',
        actual: [
          first.id === second.id,
          second.attempts,
          stale,
          before?.action === 'beta.preapproval.update'
            ? before.mailState
            : null,
          after?.action === 'beta.preapproval.update' ? after.mailState : null,
        ],
        expected: [true, 2, false, 'unknown', 'suppressed'],
      });
    } finally {
      await db.close();
    }
  });
});
