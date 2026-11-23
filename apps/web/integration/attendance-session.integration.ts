import { hostWaits } from '@daisy/worker/host';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import type {
  AttendanceReceiptSession,
  AttendanceStore,
} from '@daisy/db/attendance';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { attendanceReceiptSchema } from '@daisy/protocol/attendance';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { withAttendanceRound } from './attendance.test-support';
import { createTestApp } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';

setupRitewayBun();
requireTestServices(process.env);

test('the actual receipt application rolls back failed settlement and fences escaped capabilities', async () =>
  withAttendanceRound(async ({ f, roundId, segmentId }) => {
    const principal = { kind: 'human', actorId: f.host.actorId } as const;
    let escaped: AttendanceReceiptSession | undefined;
    for (const fault of [
      'prepare-refusal',
      'apply-refusal',
      'apply-exception',
      'missing-apply',
      'repeat-apply',
    ] as const) {
      const commandId = createId();
      const store: AttendanceStore = {
        withAttendanceDiscovery: f.store.withAttendanceDiscovery,
        withAttendanceReceipt: (input, work) =>
          f.store.withAttendanceReceipt(input, async (session) => {
            escaped = session;
            await work({
              ...session,
              prepareReceipt: async (participantId) => {
                const stamp = await session.prepareReceipt(participantId);
                if (fault === 'prepare-refusal')
                  throw createAppError('AUTHORIZATION');
                return stamp;
              },
              apply: async () => {
                if (fault === 'missing-apply') return;
                await session.apply();
                if (fault === 'apply-refusal')
                  throw createAppError('AUTHORIZATION');
                if (fault === 'apply-exception')
                  throw createAppError('INFRASTRUCTURE');
                if (fault === 'repeat-apply') await session.apply();
              },
            });
          }),
      };
      const attendance = createAttendanceFeature({
        checkIns: store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId: createId(),
      });
      await assertRejects({
        given: fault,
        should: 'roll back the actual receipt and its alias',
        actual: () =>
          attendance.checkIn(principal, roundId, {
            version: 1,
            commandId,
            segmentId,
          }),
        code: fault.endsWith('refusal')
          ? 'AUTHORIZATION'
          : fault === 'apply-exception'
            ? 'INFRASTRUCTURE'
            : 'CONFLICT',
      });
      const [row] = await f.sql`select
        (select count(*)::int from round_commands where command_id=${commandId}) as aliases,
        (select count(*)::int from round_check_ins where command_id=${commandId}) as receipts,
        (select count(*)::int from round_check_in_attempts where command_id=${commandId} and state='pending') as pending,
        (select count(*)::int from round_check_in_attempts where command_id=${commandId} and state='aborted') as aborted`;
      assert({
        given: fault,
        should: 'retain only the settled aborted attempt',
        actual: { ...row },
        expected: { aliases: 0, receipts: 0, pending: 0, aborted: 1 },
      });
      const released = escaped;
      if (!released) throw new Error('Receipt session not captured');
      await assertRejects({
        given: 'a receipt capability after its transaction ended',
        should: 'refuse before any write',
        actual: () => released.apply(),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'a reader after its receipt transaction ended',
        should: 'refuse before a query',
        actual: () => released.readClosedSegments(),
        code: 'CONFLICT',
      });
    }
  }));

test('signed receipt replay waiting on the canonical account fence sees revocation and preserves its original stamp', async () => {
  const app = createTestApp();
  const accounts = createAccountFlows(app);
  const signed = await accounts.signUp();
  if (
    (await accounts.claim(signed.cookie, { username: uniqueName() })).status !==
    201
  )
    throw new Error('Member required');
  const identity = await accounts.identifyAs(signed.cookie);
  if (identity.state !== 'member' || !identity.principal.actorId)
    throw new Error('Actual signed member required');
  const member = {
    userId: identity.principal.userId,
    actorId: identity.principal.actorId,
  };
  await withAttendanceRound(async ({ f, roundId, segmentId }) => {
    const envelope = { version: 1, commandId: createId(), segmentId };
    const post = (commandId: string) =>
      app.routes.attendance.checkIn(
        app.jsonPost(
          `/api/rounds/${roundId}/check-in`,
          { ...envelope, commandId },
          { cookie: signed.cookie },
        ),
        roundId,
      );
    const firstResponse = await post(envelope.commandId);
    assert({
      given: 'a signed actual member in a real shared-clock speech',
      should: 'record through the production route',
      actual: firstResponse.status,
      expected: 200,
    });
    const first = attendanceReceiptSchema.parse(await firstResponse.json());
    const holder = await f.sql.reserve();
    const pending: Promise<Response>[] = [];
    try {
      await holder`begin`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      await holder`select id from users where id=${member.userId} for update`;
      const aliasId = createId();
      pending.push(post(envelope.commandId), post(aliasId));
      for (const request of pending) {
        const state = await finishedOrBlockedBehind(
          request,
          f.sql,
          backend.pid,
          { waits: hostWaits, deadlineMs: 500 },
        );
        assert({
          given:
            'an actual signed replay or fresh alias behind the account holder',
          should: 'reach the canonical account wait',
          actual: state,
          expected: 'blocked',
        });
      }
      await holder`update account_beta_access set state='revoked',revision=revision+1,decided_at=statement_timestamp() where user_id=${member.userId}`;
      await holder`update users set version=version+1 where id=${member.userId}`;
      await holder`commit`;
      const responses = await Promise.all(pending);
      assert({
        given: 'revocation committed while both actual requests waited',
        should:
          'refuse both replay and fresh alias under current account facts',
        actual: responses.map((response) => response.status),
        expected: [403, 403],
      });
      const [facts] = await f.sql`select
        (select count(*)::int from round_commands where round_id=${roundId} and type='check_in') as aliases,
        (select count(*)::int from round_check_ins where round_id=${roundId}) as receipts,
        (select count(*)::int from round_check_in_attempts where round_id=${roundId} and state='pending') as pending,
        (select count(*)::int from round_check_in_attempts where round_id=${roundId} and state='aborted') as aborted,
        (select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from round_check_ins where round_id=${roundId}) as stamp`;
      assert({
        given: 'both fenced refusals',
        should:
          'keep the original native stamp and one alias/fact with no uncertain writer',
        actual: { ...facts },
        expected: {
          aliases: 1,
          receipts: 1,
          pending: 0,
          aborted: 2,
          stamp: first.receivedAt,
        },
      });
    } finally {
      await holder`rollback`;
      holder.release();
      await Promise.allSettled(pending);
    }
  }, member);
});

test('a receipt apply that outlives its callback cannot reopen a released session', async () =>
  withAttendanceRound(
    async ({ f, attendance: original, roundId, segmentId }) => {
      let escaped: AttendanceReceiptSession | undefined;
      let pending: Promise<void> | undefined;
      await original.checkIn(
        { kind: 'human', actorId: f.host.actorId },
        roundId,
        { version: 1, commandId: createId(), segmentId },
      );
      const commandId = createId();
      const store: AttendanceStore = {
        withAttendanceDiscovery: f.store.withAttendanceDiscovery,
        withAttendanceReceipt: (input, work) =>
          f.store.withAttendanceReceipt(input, async (session) => {
            escaped = session;
            await work({
              ...session,
              apply: async () => {
                // Deliberately return before storage completes, as a faulty caller could.
                pending = session.apply();
                void pending.catch(() => {});
              },
            });
          }),
      };
      const attendance = createAttendanceFeature({
        checkIns: store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId: createId(),
      });
      await assertRejects({
        given:
          'an application callback returning with its write still in flight',
        should: 'refuse an unsettled transaction',
        actual: () =>
          attendance.checkIn(
            { kind: 'human', actorId: f.host.actorId },
            roundId,
            { version: 1, commandId, segmentId },
          ),
        code: 'CONFLICT',
      });
      if (!escaped || !pending) throw new Error('In-flight apply required');
      await Promise.allSettled([pending]);
      const released = escaped;
      await assertRejects({
        given: 'the delayed apply has finished after callback release',
        should: 'keep the reader closed before any query',
        actual: () => released.readClosedSegments(),
        code: 'CONFLICT',
      });
      const [row] = await f.sql`select
      (select count(*)::int from round_commands where command_id=${commandId}) as aliases,
      (select count(*)::int from round_check_ins where command_id=${commandId}) as receipts,
      (select count(*)::int from round_check_in_attempts where command_id=${commandId} and state='aborted') as aborted`;
      assert({
        given: 'the escaped write',
        should: 'roll back both writes and settle its attempt',
        actual: { ...row },
        expected: { aliases: 0, receipts: 0, aborted: 1 },
      });
    },
  ));
