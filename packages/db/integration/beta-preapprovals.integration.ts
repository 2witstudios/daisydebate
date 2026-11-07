import { subjectRightsVerificationBindings } from '../src/privacy/verification-bindings';
import { drizzle } from 'drizzle-orm/bun-sql';
import { runPrivacyErasure } from '../src/privacy/operations';
import { betaAccessPrivacyAdopter } from '../src/beta-access-privacy';
import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { PreapprovalCommand } from '@daisy/protocol/beta-preapproval';
import { createDatabase } from '../src';
import { withFixture, rejectedBy, type Fixture } from './constraint-helpers';
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
    await f.sql`select claimed_user_id, revision from beta_preapprovals where id = ${id}`;
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
            (await grant(f, id)).claimed_user_id,
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
            (await grant(f, saved.preapprovalId)).claimed_user_id,
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
            (await grant(f, result.preapprovalId)).claimed_user_id,
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
      const account = await pendingAccount(f);
      const command = add(`${account.userId}@operator.invalid`, true);
      try {
        let refused = false;
        let deadlineChecks = 0;
        try {
          await db.runPreapprovalCommand(
            inputFor(command, () => ++deadlineChecks === 1),
          );
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
          actual: [
            refused,
            row.count,
            receipt.count,
            mail.count,
            await access(f, account.userId),
          ],
          expected: [true, 0, 0, 0, 'pending'],
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
          userIds.includes(
            (await grant(f, saved.preapprovalId)).claimed_user_id,
          ),
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
              current?.claimed_user_id === userId &&
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
        outcome: { kind: 'sent' },
      });
      const after = await db.readOperatorCommand({
        commandId: command.commandId,
        serviceId: 'daisy-admin',
      });
      assert({
        given:
          'an invitation whose worker crashes before settlement, then an acknowledged retry',
        should:
          'retain one intent/provider id, reject the old lease and show honest unknown then sent states',
        actual: [
          first.id === second.id,
          second.attempts,
          stale,
          before?.action === 'beta.preapproval.update'
            ? before.mailState
            : null,
          after?.action === 'beta.preapproval.update' ? after.mailState : null,
        ],
        expected: [true, 2, false, 'unknown', 'sent'],
      });
    } finally {
      await db.close();
    }
  });
});

test('unverified, mismatched and moderated identities cannot consume a grant', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    try {
      const outcomes: unknown[] = [];
      for (const kind of ['unverified', 'mismatched', 'moderated'] as const) {
        const account = await pendingAccount(f);
        if (kind === 'unverified')
          await f.sql`update users set email_verified = false where id = ${account.userId}`;
        if (kind === 'moderated')
          await f.sql`insert into moderation_actions (id, user_id, kind, starts_at, operator_ref) values (${createId()}, ${account.userId}, 'ban', now() - interval '1 minute', ${'o'.repeat(24)})`;
        const email = `${kind === 'mismatched' ? createId() : account.userId}@operator.invalid`;
        const saved = await db.runPreapprovalCommand(inputFor(add(email)));
        outcomes.push([
          await access(f, account.userId),
          (await grant(f, saved.preapprovalId)).claimed_user_id,
        ]);
      }
      assert({
        given:
          'an unverified email, another email, and a currently banned account',
        should: 'leave every account pending and every grant unclaimed',
        actual: outcomes,
        expected: [
          ['pending', null],
          ['pending', null],
          ['pending', null],
        ],
      });
    } finally {
      await db.close();
    }
  });
});

test('concurrent preapproval and revocation never restore revoked access', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const account = await pendingAccount(f);
    const email = `${account.userId}@operator.invalid`;
    try {
      const [addition, revocation] = await Promise.allSettled([
        db.runPreapprovalCommand(inputFor(add(email))),
        db.runBetaAccessCommand(accessCommand(account.userId, 'revoked', 1)),
      ]);
      if (revocation.status === 'rejected') {
        const [row] =
          await f.sql`select revision from account_beta_access where user_id = ${account.userId}`;
        await db.runBetaAccessCommand(
          accessCommand(account.userId, 'revoked', row.revision),
        );
      }
      await db.runPreapprovalCommand(inputFor(add(email)));
      assert({
        given:
          'a grant added concurrently with account revocation, followed by another add',
        should:
          'serialize the grant and keep the final revocation authoritative',
        actual: [addition.status, await access(f, account.userId)],
        expected: ['fulfilled', 'revoked'],
      });
    } finally {
      await db.close();
    }
  });
});

test('under-13 deletion removes unused preapproval and owed invitations', async () => {
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
    try {
      const saved = await db.runPreapprovalCommand(inputFor(add(email, true)));
      const deleted = await db.deleteProvisionalUser({
        userId,
        signInPurpose: 'magic-link:sign-in',
        emailChangePurposes: [],
        recipientHashOf: () => 'a'.repeat(64),
      });
      const [mail] =
        await f.sql`select count(*)::int as count from mail_intents where preapproval_id = ${saved.preapprovalId}`;
      assert({
        given: 'an invited provisional signup that answers under 13',
        should: 'keep neither its unused email grant nor its invitation',
        actual: [deleted, await grant(f, saved.preapprovalId), mail.count],
        expected: ['deleted', undefined, 0],
      });
    } finally {
      await db.close();
    }
  });
});

test('an account committed between discovery and the email fence is approved by a fresh account-first attempt', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const signup = new SQL(url, { max: 1 });
    const userId = createId();
    const actorId = createId();
    const email = `${userId}@example.test`;
    f.track('users', userId);
    f.track('actors', actorId);
    let addition: ReturnType<typeof db.runPreapprovalCommand> | undefined;
    try {
      await signup.begin(async (tx) => {
        // A fresh signup's committed output is invisible to discovery until
        // this transaction releases the same email fence enrollment uses.
        await tx`insert into users (id, email, email_verified, username) values (${userId}, ${email}, true, ${`i-${userId}`})`;
        await tx`insert into actors (id, user_id, kind) values (${actorId}, ${userId}, 'human')`;
        await tx`insert into account_age (user_id, birth_month, recorded_at) values (${userId}, '2000-01', now())`;
        await tx`insert into account_beta_access (user_id, state, requested_at, provenance) values (${userId}, 'pending', now(), 'signup')`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${email}, 59080))`;
        addition = db.runPreapprovalCommand(inputFor(add(email)));
        let waiting = false;
        for (let poll = 0; poll < 100 && !waiting; poll += 1) {
          const [lock] =
            await f.sql`select exists(select 1 from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database()) and classid = ((hashtextextended(${email}, 59080) >> 32) & 4294967295)::oid and objid = (hashtextextended(${email}, 59080) & 4294967295)::oid) as waiting`;
          waiting = lock.waiting;
          if (!waiting) await Bun.sleep(10);
        }
        if (!waiting) throw new Error('Add did not reach the held email fence');
      });
      const result = await addition!;
      assert({
        given:
          'a matching eligible account that commits only after add has discovered and locked its initial account set',
        should:
          'restart account-first and approve it before committing the grant',
        actual: [
          await access(f, userId),
          (await grant(f, result.preapprovalId)).claimed_user_id,
        ],
        expected: ['approved', userId],
      });
    } finally {
      await addition?.catch(() => {});
      await signup.close();
      await db.close();
    }
  });
});

test('removal and erasure use email-before-grant-before-mail locking', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const blocker = new SQL(url, { max: 1 });
    const erasure = new SQL(url, { max: 1 });
    const account = await pendingAccount(f);
    const email = `${account.userId}@operator.invalid`;
    let removal: ReturnType<typeof db.runPreapprovalCommand> | undefined;
    let erased: ReturnType<typeof runPrivacyErasure> | undefined;
    try {
      const saved = await db.runPreapprovalCommand(inputFor(add(email, true)));
      await blocker.begin(async (tx) => {
        await tx`select id from beta_preapprovals where id = ${saved.preapprovalId} for update`;
        removal = db.runPreapprovalCommand(
          inputFor({
            v: 1,
            commandId: createId(),
            adminAuditHead: 'a'.repeat(64),
            operation: 'remove',
            preapprovalId: saved.preapprovalId,
            expectedRevision: saved.revision,
          }),
        );
        void removal.catch(() => {});
        const emailLock = async (granted: boolean) => {
          const [row] =
            await f.sql`select exists(select 1 from pg_locks where locktype = 'advisory' and granted = ${granted} and database = (select oid from pg_database where datname = current_database()) and classid = ((hashtextextended(${email}, 59080) >> 32) & 4294967295)::oid and objid = (hashtextextended(${email}, 59080) & 4294967295)::oid) as held`;
          return row.held as boolean;
        };
        const observe = async (granted: boolean) => {
          for (let poll = 0; poll < 100; poll += 1) {
            if (await emailLock(granted)) return;
            await Bun.sleep(10);
          }
          throw new Error(
            'Expected account/email lock ordering was not observed',
          );
        };
        await observe(true);
        erased = runPrivacyErasure(
          drizzle({ client: erasure }),
          {
            subject: { userId: account.userId, actorId: account.actorId },
            now: new Date().toISOString(),
            vendors: [],
            jobIds: [],
          },
          [betaAccessPrivacyAdopter],
          subjectRightsVerificationBindings,
        );
        void erased.catch(() => {});
        // Erasure must wait at the email fence while removal owns it and
        // waits on the held grant. It must never take the mail row first.
        await observe(false);
      });
      const [removed] = await Promise.all([removal!, erased!]);
      const [user] =
        await f.sql`select deleted_at is not null as erased from users where id = ${account.userId}`;
      assert({
        given:
          'real removal paused before its grant lock while account erasure starts concurrently',
        should:
          'serialize at the email fence and complete both without a grant/mail deadlock',
        actual: [
          removed.outcome,
          user.erased,
          await grant(f, saved.preapprovalId),
        ],
        expected: ['removed', true, undefined],
      });
    } finally {
      await Promise.allSettled([removal, erased]);
      await blocker.close();
      await erasure.close();
      await db.close();
    }
  });
});

test('invitation delivery facts distinguish suppression, rejection, uncertainty and retired detail', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    try {
      const states = [];
      for (const errorCode of [
        'suppressed',
        'delivery',
        'delivery-unknown',
      ] as const) {
        const command = add(`${createId()}@example.test`, true);
        await db.runPreapprovalCommand(inputFor(command));
        const [intent] =
          await f.sql`select id from mail_intents where dedupe_key = ${`beta-invitation:${command.commandId}`}`;
        const claims = await db.claimMailIntents({
          limit: 50,
          leaseMs: 60000,
          nextToken: () => `${createId()}${createId()}`,
        });
        const claim = claims.find((item) => item.id === intent.id)!;
        await db.settleMailIntent({
          id: claim.id,
          token: claim.token,
          outcome: {
            kind: errorCode === 'suppressed' ? 'cancelled' : 'failed',
            errorCode,
          },
        });
        const read = await db.readOperatorCommand({
          commandId: command.commandId,
          serviceId: 'daisy-admin',
        });
        states.push(
          read?.action === 'beta.preapproval.update' ? read.mailState : null,
        );
        await f.sql`delete from mail_intents where id = ${intent.id}`;
        const retired = await db.readOperatorCommand({
          commandId: command.commandId,
          serviceId: 'daisy-admin',
        });
        states.push(
          retired?.action === 'beta.preapproval.update'
            ? retired.mailState
            : null,
        );
      }
      assert({
        given:
          'fresh suppressed, definitely rejected and uncertain terminal invitations followed by retained receipts with retired delivery rows',
        should:
          'report each truthfully and never call missing delivery evidence none',
        actual: states,
        expected: [
          'suppressed',
          'unknown',
          'failed',
          'unknown',
          'unknown',
          'unknown',
        ],
      });
    } finally {
      await db.close();
    }
  });
});

test('mail recipient variants reject detached active invitations and cross-purpose grant references', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const account = await pendingAccount(f);
    const terminalId = createId();
    try {
      const saved = await db.runPreapprovalCommand(
        inputFor(add(`${account.userId}@operator.invalid`)),
      );
      const detached = await rejectedBy(
        () =>
          f.sql`insert into mail_intents (id, purpose, dedupe_key, next_attempt_at) values (${createId()}, 'beta-invitation', ${createId()}, now())`,
      );
      const crossPurpose = await rejectedBy(
        () =>
          f.sql`insert into mail_intents (id, purpose, recipient_user_id, preapproval_id, dedupe_key, next_attempt_at) values (${createId()}, 'beta-approved', ${account.userId}, ${saved.preapprovalId}, ${createId()}, now())`,
      );
      await f.sql`insert into mail_intents (id, purpose, dedupe_key, next_attempt_at, state, completed_at) values (${terminalId}, 'beta-invitation', ${createId()}, now(), 'cancelled', now())`;
      assert({
        given:
          'an active invitation without a grant, an account email with a grant reference, and a terminal invitation whose grant was removed',
        should:
          'reject impossible recipient variants while retaining terminal metadata',
        actual: [detached, crossPurpose],
        expected: [
          'mail_intents_preapproval_recipient_check',
          'mail_intents_preapproval_recipient_check',
        ],
      });
    } finally {
      await f.sql`delete from mail_intents where id = ${terminalId}`;
      await db.close();
    }
  });
});

test('explicit resend creates one new invitation after terminal delivery and replays safely', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    try {
      const saved = await db.runPreapprovalCommand(
        inputFor(add(`${createId()}@example.test`, true)),
      );
      const claims = await db.claimMailIntents({
        limit: 50,
        leaseMs: 60000,
        nextToken: () => `${createId()}${createId()}`,
      });
      for (const claim of claims)
        await db.settleMailIntent({
          id: claim.id,
          token: claim.token,
          outcome: { kind: 'sent' },
        });
      const resend = inputFor({
        v: 1,
        commandId: createId(),
        adminAuditHead: 'a'.repeat(64),
        operation: 'invite',
        preapprovalId: saved.preapprovalId,
        expectedRevision: saved.revision,
      });
      const replayed = await Promise.all([
        db.runPreapprovalCommand(resend),
        db.runPreapprovalCommand(resend),
      ]);
      let stale = false;
      try {
        await db.runPreapprovalCommand(
          inputFor({ ...resend.command, commandId: createId() }),
        );
      } catch (error) {
        stale = (error as { code?: string }).code === 'CONFLICT';
      }
      const [mail] =
        await f.sql`select count(*)::int as count, count(*) filter (where state = 'queued')::int as queued from mail_intents where preapproval_id = ${saved.preapprovalId}`;
      assert({
        given:
          'a delivered invitation, an explicit resend replayed concurrently, and an old revision submitted again',
        should: 'owe exactly one new intent and refuse the stale form',
        actual: [replayed[0], replayed[1], mail.count, mail.queued, stale],
        expected: [replayed[0], replayed[0], 2, 1, true],
      });
    } finally {
      await db.close();
    }
  });
});

test('preapproval listing pages by stable opaque grant ids without losing entries', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    try {
      const ids = [];
      for (let index = 0; index < 3; index += 1)
        ids.push(
          (
            await db.runPreapprovalCommand(
              inputFor(add(`${createId()}@example.test`)),
            )
          ).preapprovalId,
        );
      const first = await db.listBetaPreapprovals({ limit: 2 });
      const second = await db.listBetaPreapprovals({
        limit: 2,
        cursor: first.at(-1)!.id,
      });
      assert({
        given: 'three preapprovals split across two bounded pages',
        should: 'return every grant once with unused and no-invitation facts',
        actual: [
          [...first, ...second].map((entry) => entry.id),
          [...first, ...second].every(
            (entry) => entry.status === 'unused' && entry.invitation === 'none',
          ),
        ],
        expected: [ids.sort().reverse(), true],
      });
    } finally {
      await db.close();
    }
  });
});

test('a claimed invitation stops being owed when its verified email changes', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    const account = await pendingAccount(f);
    try {
      const saved = await db.runPreapprovalCommand(
        inputFor(add(`${account.userId}@operator.invalid`, true)),
      );
      await f.sql`update users set email = ${`${createId()}@example.test`} where id = ${account.userId}`;
      const [intent] =
        await f.sql`select id from mail_intents where preapproval_id = ${saved.preapprovalId}`;
      const claims = await db.claimMailIntents({
        limit: 50,
        leaseMs: 60000,
        nextToken: () => `${createId()}${createId()}`,
      });
      const claim = claims.find((item) => item.id === intent.id)!;
      const delivery = await db.readMailIntentDelivery(claim.id);
      let refused = false;
      try {
        await db.runPreapprovalCommand(
          inputFor({
            v: 1,
            commandId: createId(),
            adminAuditHead: 'a'.repeat(64),
            operation: 'invite',
            preapprovalId: saved.preapprovalId,
            expectedRevision: saved.revision,
          }),
        );
      } catch (error) {
        refused = (error as { code?: string }).code === 'CONFLICT';
      }
      await db.settleMailIntent({
        id: claim.id,
        token: claim.token,
        outcome: { kind: 'cancelled', errorCode: 'not-owed' },
      });
      assert({
        given:
          'a consumed preapproval whose account verified email has moved to another address',
        should:
          'cancel the old-address invitation and refuse resend while preserving account approval',
        actual: [delivery.kind, refused, await access(f, account.userId)],
        expected: ['not-owed', true, 'approved'],
      });
    } finally {
      await db.close();
    }
  });
});

test('long-outage invitation recovery preserves the grant and never assumes an expired provider key is safe', async () => {
  await withFixture(url, async (f) => {
    const db = trackedDatabase(f, { url, nextActorId: createId });
    try {
      const command = add(`${createId()}@example.test`, true);
      const saved = await db.runPreapprovalCommand(inputFor(command));
      const claims = await db.claimMailIntents({
        limit: 50,
        leaseMs: 60000,
        nextToken: () => `${createId()}${createId()}`,
      });
      const [intent] =
        await f.sql`select id from mail_intents where preapproval_id = ${saved.preapprovalId}`;
      const first = claims.find((item) => item.id === intent.id)!;
      await f.sql`update mail_intents set created_at = now() - interval '2 days', lease_expires_at = now() - interval '1 minute' where id = ${first.id}`;
      const retry = (
        await db.claimMailIntents({
          limit: 50,
          leaseMs: 60000,
          nextToken: () => `${createId()}${createId()}`,
        })
      ).find((item) => item.id === first.id)!;
      const delivery = await db.readMailIntentDelivery(retry.id);
      await db.settleMailIntent({
        id: retry.id,
        token: retry.token,
        outcome: { kind: 'failed', errorCode: 'delivery-unknown' },
      });
      const result = await db.readOperatorCommand({
        commandId: command.commandId,
        serviceId: 'daisy-admin',
      });
      const resent = await db.runPreapprovalCommand(
        inputFor({
          v: 1,
          commandId: createId(),
          adminAuditHead: 'a'.repeat(64),
          operation: 'invite',
          preapprovalId: saved.preapprovalId,
          expectedRevision: saved.revision,
        }),
      );
      assert({
        given:
          'a worker lease recovered after two days, beyond provider idempotency retention',
        should:
          'expose an elapsed send deadline and unknown outcome while the unused grant remains valid for explicit fresh resend',
        actual: [
          delivery.kind === 'invitation' &&
            Date.parse(delivery.sendBefore) < new Date().getTime(),
          result?.action === 'beta.preapproval.update'
            ? result.mailState
            : null,
          (await grant(f, saved.preapprovalId)).claimed_user_id,
          resent.mail,
        ],
        expected: [true, 'unknown', null, 'queued'],
      });
    } finally {
      await db.close();
    }
  });
});
