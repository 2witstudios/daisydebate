import { hostWaits } from '@daisy/worker/host';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import {
  preapprovalResultSchema,
  type PreapprovalCommand,
} from '@daisy/protocol/beta-preapproval';
import { operatorLimits } from '@daisy/protocol/operator';
import {
  api,
  signed,
  now as signedNow,
} from '../src/features/operator-api/router.test-support';
import { withBeta } from './preapproval.test-support';

setupRitewayBun();
const add = (
  email: string,
  invite = false,
): Extract<PreapprovalCommand, { operation: 'add' }> => ({
  v: 1,
  commandId: createId(),
  adminAuditHead: 'a'.repeat(64),
  operation: 'add',
  email,
  invite,
});
const put = (command: PreapprovalCommand) =>
  signed({
    method: 'PUT',
    path: '/operator/v1/beta-preapprovals',
    body: JSON.stringify(command),
  });

test('the signed preapproval route applies fresh facts, replays, refuses stale revisions and removes atomically', async () => {
  await withBeta(async ({ sql, db, account }) => {
    const person = await account();
    const { handle } = api({ store: db, nextId: createId });
    const command = add(person.email);
    const firstResponse = await handle(put(command));
    const first = preapprovalResultSchema.parse(await firstResponse.json());
    const replayResponse = await handle(put(command));
    const replay = await replayResponse.json();
    const invite: PreapprovalCommand = {
      v: 1,
      commandId: createId(),
      adminAuditHead: 'a'.repeat(64),
      operation: 'invite',
      preapprovalId: first.preapprovalId,
      expectedRevision: first.revision,
    };
    const invitedResponse = await handle(put(invite));
    const invited = preapprovalResultSchema.parse(await invitedResponse.json());
    const stale = await handle(put({ ...invite, commandId: createId() }));
    const removedResponse = await handle(
      put({
        v: 1,
        commandId: createId(),
        adminAuditHead: 'a'.repeat(64),
        operation: 'remove',
        preapprovalId: first.preapprovalId,
        expectedRevision: invited.revision,
      }),
    );
    const removed = preapprovalResultSchema.parse(await removedResponse.json());
    const readback = await handle(
      signed({
        method: 'GET',
        path: `/operator/v1/commands/${invite.commandId}`,
      }),
    );
    const receipt = await readback.json();
    const [effects] = await sql`select
      (select state from account_beta_access where user_id=${person.userId}) as access,
      (select count(*)::int from beta_preapprovals where id=${first.preapprovalId}) as grants,
      (select state from mail_intents where dedupe_key=${`beta-invitation:${invite.commandId}`}) as mail`;
    assert({
      given:
        'real signed add, exact replay, fresh invite, stale invite and remove through the actual application driver',
      should:
        'preserve typed results, issuer readback, fresh revision refusal and atomic invitation cancellation',
      actual: [
        firstResponse.status,
        replayResponse.status,
        replay,
        first.mail,
        invitedResponse.status,
        invited.mail,
        stale.status,
        removedResponse.status,
        removed.outcome,
        readback.status,
        receipt.action,
        receipt.mailState,
        effects,
      ],
      expected: [
        200,
        200,
        first,
        'none',
        200,
        'queued',
        409,
        200,
        'removed',
        200,
        'beta.preapproval.update',
        'cancelled',
        { access: 'approved', grants: 0, mail: 'cancelled' },
      ],
    });
  });
});

test('the actual signed driver restarts after account discovery changes behind the email fence', async () => {
  await withBeta(async ({ sql, db, account }) => {
    const person = await account();
    const email = `${createId()}@example.test`;
    let attempts = 0;
    const { handle } = api({
      store: {
        ...db,
        preapprovalCommand: (input, work) => {
          attempts += 1;
          return db.preapprovalCommand(input, work);
        },
      },
      nextId: createId,
    });
    let response: Promise<Response> | undefined;
    let waited = '';
    try {
      await sql.begin(async (tx) => {
        await tx`update users set email=${email} where id=${person.userId}`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${email},59080))`;
        const [holder] = await tx`select pg_backend_pid() as pid`;
        response = handle(put(add(email, true)));
        waited = await finishedOrBlockedBehind(response, sql, holder!.pid, {
          waits: hostWaits,
          deadlineMs: 1500,
        });
      });
      const answer = await response!;
      const result = preapprovalResultSchema.parse(await answer.json());
      const [facts] =
        await sql`select (select state from account_beta_access where user_id=${person.userId}) as access,(select claimed_user_id from beta_preapprovals where id=${result.preapprovalId}) as claimed,(select count(*)::int from operator_command_receipts where command_id=${result.commandId}) as receipts`;
      assert({
        given:
          'an account whose matching verified email commits only after the signed add discovered its initial account set',
        should:
          'finish the old transaction and retry account-first with fresh facts, approving exactly once',
        actual: [waited, answer.status, attempts, facts],
        expected: [
          'blocked',
          200,
          2,
          { access: 'approved', claimed: person.userId, receipts: 1 },
        ],
      });
    } finally {
      await response?.catch(() => undefined);
    }
  });
});

test('the signed driver rolls back a prepared invitation when its final deadline expires behind a real fence', async () => {
  await withBeta(async ({ sql, db }) => {
    const command = add(`${createId()}@example.test`, true);
    let clock = signedNow;
    const { handle } = api({ store: db, nextId: createId, nowMs: () => clock });
    let response: Promise<Response> | undefined;
    let waited = '';
    try {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${command.email},59080))`;
        const [holder] = await tx`select pg_backend_pid() as pid`;
        response = handle(put(command));
        waited = await finishedOrBlockedBehind(response, sql, holder!.pid, {
          waits: hostWaits,
          deadlineMs: 1500,
        });
        clock = signedNow + operatorLimits.skewMs + 1;
      });
      const answer = await response!;
      const [effects] =
        await sql`select (select count(*)::int from beta_preapprovals where email=${command.email}) as grants,(select count(*)::int from operator_command_receipts where command_id=${command.commandId}) as receipts,(select count(*)::int from mail_intents where dedupe_key=${`beta-invitation:${command.commandId}`}) as mail`;
      assert({
        given:
          'a genuinely signed add admitted while live but delayed at the real email fence beyond its deadline',
        should:
          'refuse and atomically discard prepared grant, invitation and receipt',
        actual: [waited, answer.status, effects],
        expected: ['blocked', 409, { grants: 0, receipts: 0, mail: 0 }],
      });
    } finally {
      await response?.catch(() => undefined);
    }
  });
});
