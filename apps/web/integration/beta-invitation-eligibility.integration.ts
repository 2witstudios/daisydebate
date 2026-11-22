import { runPreapprovalCommand } from '../src/features/operator-api/preapproval-command';
import { z } from 'zod';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { instantMs } from '@daisy/clock';
import { sha3Hex } from '@daisy/digest';
import { type PreapprovalCommand } from '@daisy/protocol/beta-preapproval';
import { withBeta } from './preapproval.test-support';
import { readBetaInvitationDelivery } from '../src/features/beta-access/invitation-delivery';
import { createMailIntentDelivery } from '../src/features/beta-access/mail-delivery';
import { createResendSender } from '../src/features/mail/resend-sender';

setupRitewayBun();
const inputFor = (command: PreapprovalCommand) => ({
  command,
  serviceId: 'daisy-admin',
  operatorRef: 'o'.repeat(24),
  requestDigest: sha3Hex(JSON.stringify(command)),
  nextId: createId,
  live: () => true,
});
const add = (email: string, invite = false): PreapprovalCommand => ({
  v: 1,
  commandId: createId(),
  adminAuditHead: 'a'.repeat(64),
  operation: 'add',
  email,
  invite,
});
type Db = import('@daisy/db').Database;

/** Real application worker and Resend adapter; its HTTP edge is a test provider. */
function worker(db: Db) {
  const sent: string[][] = [],
    failed: unknown[] = [];
  const sender = createResendSender({
    apiKey: 'test-provider-key',
    from: 'beta@example.test',
    nowMs: Date.now,
    ids: { next: createId },
    fetch: async (_request, init) => {
      sent.push(
        z
          .object({ to: z.array(z.string()) })
          .parse(JSON.parse(String(init?.body))).to,
      );
      return Response.json({ id: createId() });
    },
  });
  return {
    sent,
    failed,
    run: createMailIntentDelivery({
      store: db,
      deliver: async (message) => {
        await sender.send(message);
        return 'sent';
      },
      ownerAddress: undefined,
      appUrl: 'https://daisy.example',
      nextToken: () => createId() + createId(),
      now: () => new Date().toISOString(),
      failed: (error) => failed.push(error),
    }).run,
  };
}

// Moved behavioral cases: expected outcomes are unchanged; the application owns delivery now.
test('a claimed invitation stops being owed when its verified email changes', async () => {
  await withBeta(async ({ sql, db, account }) => {
    const person = await account();
    const saved = await runPreapprovalCommand(
      db,
      inputFor(add(person.email, true)),
    );
    await sql`update users set email=${`${createId()}@example.test`} where id=${person.userId}`;
    const [intent] =
      await sql`select id from mail_intents where preapproval_id=${saved.preapprovalId}`;
    const claims = await db.claimMailIntents({
      limit: 50,
      leaseMs: 60000,
      maxAttempts: 8,
      nextToken: () => createId() + createId(),
    });
    const claim = claims.find((item) => item.id === intent!.id)!;
    const read = await db.readMailIntentDelivery(claim.id);
    const delivery =
      read.kind === 'beta-invitation'
        ? await readBetaInvitationDelivery(read)
        : read;
    let refused = false;
    try {
      await runPreapprovalCommand(
        db,
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
    const [access] =
      await sql`select state from account_beta_access where user_id=${person.userId}`;
    assert({
      given:
        'a consumed preapproval whose account verified email has moved to another address',
      should:
        'cancel the old-address invitation and refuse resend while preserving account approval',
      actual: [delivery.kind, refused, access!.state],
      expected: ['not-owed', true, 'approved'],
    });
  });
});

test('long-outage invitation recovery preserves the grant and never assumes an expired provider key is safe', async () => {
  await withBeta(async ({ sql, db }) => {
    const command = add(`${createId()}@example.test`, true);
    const saved = await runPreapprovalCommand(db, inputFor(command));
    const claims = await db.claimMailIntents({
      limit: 50,
      leaseMs: 60000,
      maxAttempts: 8,
      nextToken: () => createId() + createId(),
    });
    const [intent] =
      await sql`select id from mail_intents where preapproval_id=${saved.preapprovalId}`;
    const first = claims.find((item) => item.id === intent!.id)!;
    await sql`update mail_intents set created_at=now()-interval '2 days',lease_expires_at=now()-interval '1 minute' where id=${first.id}`;
    const retry = (
      await db.claimMailIntents({
        limit: 50,
        leaseMs: 60000,
        maxAttempts: 8,
        nextToken: () => createId() + createId(),
      })
    ).find((item) => item.id === first.id)!;
    const read = await db.readMailIntentDelivery(retry.id);
    const delivery =
      read.kind === 'beta-invitation'
        ? await readBetaInvitationDelivery(read)
        : read;
    const app = worker(db);
    // The actual worker must reclaim this lease and fail it without a provider send.
    await sql`update mail_intents set lease_expires_at=now()-interval '1 minute' where id=${retry.id}`;
    await app.run(50);
    const result = await db.readOperatorCommand({
      commandId: command.commandId,
      serviceId: 'daisy-admin',
    });
    const resent = await runPreapprovalCommand(
      db,
      inputFor({
        v: 1,
        commandId: createId(),
        adminAuditHead: 'a'.repeat(64),
        operation: 'invite',
        preapprovalId: saved.preapprovalId,
        expectedRevision: saved.revision,
      }),
    );
    const [grant] =
      await sql`select claimed_user_id from beta_preapprovals where id=${saved.preapprovalId}`;
    assert({
      given:
        'a worker lease recovered after two days, beyond provider idempotency retention',
      should:
        'expose an elapsed send deadline and unknown outcome while the unused grant remains valid for explicit fresh resend',
      actual: [
        delivery.kind === 'invitation' &&
          instantMs(delivery.sendBefore) < Date.now(),
        result?.action === 'beta.preapproval.update' ? result.mailState : null,
        grant!.claimed_user_id,
        resent.mail,
      ],
      expected: [true, 'unknown', null, 'queued'],
    });
    assert({
      given:
        'the actual worker after the provider deadline with a recovered lease',
      should:
        'retain uncertainty without calling the test provider or reporting a read failure',
      actual: [app.sent.length, app.failed.length],
      expected: [0, 0],
    });
  });
});

test('the real application worker sends eligible invitations and cancels fresh ineligible facts without sending', async () => {
  await withBeta(async ({ sql, db, account }) => {
    const cases = [
      'eligible',
      'email-changed',
      'unverified',
      'age-corrected',
      'revoked',
      'erased',
    ] as const;
    const ids: string[] = [];
    const recipients: string[] = [];
    for (const change of cases) {
      const person = await account();
      const saved = await runPreapprovalCommand(
        db,
        inputFor(add(person.email, true)),
      );
      const [intent] =
        await sql`select id from mail_intents where preapproval_id=${saved.preapprovalId}`;
      ids.push(intent!.id);
      switch (change) {
        case 'eligible':
          recipients.push(person.email);
          break;
        case 'email-changed':
          await sql`update users set email=${`${createId()}@example.test`} where id=${person.userId}`;
          break;
        case 'unverified':
          await sql`update users set email_verified=false where id=${person.userId}`;
          break;
        case 'age-corrected':
          await sql`update account_age set birth_month='2020-01',version=version+1 where user_id=${person.userId}`;
          break;
        case 'revoked':
          await sql`update account_beta_access set state='revoked',decided_at=now(),revision=revision+1 where user_id=${person.userId}`;
          break;
        case 'erased':
          await sql`update users set deleted_at=now(),username=null,email=null where id=${person.userId}`;
          break;
      }
    }
    const app = worker(db);
    // The normal worker deliberately admits only three claims per lease batch.
    await app.run(50);
    await app.run(50);
    const states = [];
    for (const id of ids)
      states.push(
        (
          await sql`select state,last_error_code from mail_intents where id=${id}`
        )[0],
      );
    assert({
      given:
        'six queued invitations followed by real identity, age, revocation and erasure changes before the actual worker reads',
      should:
        'send only the still-eligible invitation and cancel the others without provider calls',
      actual: [app.sent, app.failed.length, states],
      expected: [
        [recipients],
        0,
        [
          { state: 'sent', last_error_code: null },
          ...cases
            .slice(1)
            .map(() => ({ state: 'cancelled', last_error_code: 'not-owed' })),
        ],
      ],
    });
  });
});

test('fresh verified matching accounts block only erased, restricted or revoked invitations, without claiming the grant', async () => {
  await withBeta(async ({ sql, db, account }) => {
    const ids: string[] = [];
    const recipients: string[] = [];
    for (const state of ['pending', 'revoked'] as const) {
      const email = `${createId()}@example.test`;
      if (state === 'pending') recipients.push(email);
      const saved = await runPreapprovalCommand(db, inputFor(add(email, true)));
      // The account appears after enqueue, without the separate participant claim.
      const person = await account();
      await sql`update users set email=${email} where id=${person.userId}`;
      if (state === 'revoked')
        await sql`update account_beta_access set state='revoked',decided_at=now(),revision=revision+1 where user_id=${person.userId}`;
      ids.push(
        (
          await sql`select id from mail_intents where preapproval_id=${saved.preapprovalId}`
        )[0]!.id,
      );
    }
    const app = worker(db);
    await app.run(50);
    const states = [];
    for (const id of ids)
      states.push(
        (
          await sql`select m.state,m.last_error_code,p.claimed_user_id from mail_intents m join beta_preapprovals p on p.id=m.preapproval_id where m.id=${id}`
        )[0],
      );
    assert({
      given:
        'verified pending and revoked accounts appearing at unclaimed invitation addresses after enqueue',
      should:
        'send to the pending address and cancel the revoked address, leaving both grants unclaimed',
      actual: [app.sent, app.failed.length, states],
      expected: [
        [recipients],
        0,
        [
          { state: 'sent', last_error_code: null, claimed_user_id: null },
          {
            state: 'cancelled',
            last_error_code: 'not-owed',
            claimed_user_id: null,
          },
        ],
      ],
    });
  });
});
