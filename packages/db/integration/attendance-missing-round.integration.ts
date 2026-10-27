import { requireTestServices } from '@daisy/config';
import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { attendanceEntrypoints } from '../src/attendance-entrypoints';
import { checkInAttemptLifecycle } from '../src/check-in-attempts';
import { finishedOrBlockedBehind } from '../src/testing';
import { withCheckInAttempt } from './bounded-transaction-lifecycle.test-support';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('actual attendance refuses a missing Round without manufacturing pending evidence (ISSUE-653)', async () =>
  withCheckInAttempt(async ({ f, run, attempt }) => {
    const roundId = createId();
    let accepted = false;
    const store = attendanceEntrypoints({
      run,
      nextId: () => attempt.attemptId,
    });
    await assertRejects({
      given: 'a well-formed check-in for a Round that does not exist',
      should: 'return definite absence after a confirmed empty opening',
      code: 'NOT_FOUND',
      actual: () =>
        store.recordRoundCheckIn({
          roundId,
          envelope: {
            version: 1,
            commandId: attempt.commandId,
            segmentId: createId(),
          },
          principal: { kind: 'human', actorId: attempt.actorId! },
          admits: admitsPrincipalAccess,
          payloadDigest: attempt.payloadDigest,
          acceptWindow: () => {
            accepted = true;
          },
        }),
    });
    const [facts] = await f.sql`
      select
        (select count(*)::int from round_check_in_attempts where attempt_id=${attempt.attemptId}) as markers,
        (select count(*)::int from round_commands where command_id=${attempt.commandId}) as commands,
        (select count(*)::int from round_check_ins where command_id=${attempt.commandId}) as receipts`;
    assert({
      given: 'a missing Round refused by the production bounded entrypoint',
      should: 'leave no marker, command, receipt or accepted attendance',
      actual: { ...facts, accepted },
      expected: { markers: 0, commands: 0, receipts: 0, accepted: false },
    });
  }));

test('an empty opening cannot certify a committed writer', async () =>
  withCheckInAttempt(async ({ run, attempt }) => {
    const lifecycle = checkInAttemptLifecycle({
      ...attempt,
      roundId: createId(),
    });
    await assertRejects({
      given: 'a writer bypassing the missing-Round guard and committing',
      should: 'retain conservative infrastructure refusal without a marker',
      code: 'INFRASTRUCTURE',
      actual: () => run(async () => undefined, { lifecycle }),
    });
  }));

test('Round deletion winning the opening race is absence, never a marker FK failure', async () =>
  withCheckInAttempt(async ({ f, run, attempt, lifecycle }) => {
    const deleting = await f.sql.reserve();
    try {
      await deleting`begin`;
      const [holder] = await deleting`select pg_backend_pid() as pid`;
      await deleting`delete from rounds where id=${attempt.roundId}`;
      const checking = run(async () => lifecycle.requireRound(), { lifecycle });
      const refused = assertRejects({
        given: 'a Round deletion already holding its parent row',
        should: 'observe committed absence after waiting out that deletion',
        code: 'NOT_FOUND',
        actual: () => checking,
      });
      const blocked = await finishedOrBlockedBehind(
        checking,
        f.sql,
        holder!.pid,
        { now: performance.now },
      );
      await deleting`commit`;
      await refused;
      assert({
        given: 'the opening statement raced with a real uncommitted deletion',
        should: 'serialize its parent decision instead of racing the FK',
        actual: blocked,
        expected: 'blocked',
      });
    } finally {
      await deleting`rollback`.catch(() => undefined);
      deleting.release();
    }
  }));

test('a lost empty-opening COMMIT reply cannot certify absence', async () =>
  withCheckInAttempt(async ({ run, client, attempt }) => {
    const lifecycle = checkInAttemptLifecycle({
      ...attempt,
      roundId: createId(),
    });
    const restore = loseTransactionCommitReply(client, 1);
    let entered = false;
    try {
      await assertRejects({
        given: 'zero parent rows but an unconfirmed control COMMIT',
        should: 'preserve uncertain recovery instead of returning NOT_FOUND',
        code: 'INFRASTRUCTURE',
        actual: () =>
          run(
            async () => {
              entered = true;
              lifecycle.requireRound();
            },
            { lifecycle },
          ),
      });
      assert({
        given: 'an ambiguous empty opening',
        should: 'never enter writer work or the absence guard',
        actual: entered,
        expected: false,
      });
    } finally {
      restore();
    }
  }));
