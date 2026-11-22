import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { attendanceEntrypoints } from '../src/attendance-entrypoints';
import { withCheckInAttempt } from './bounded-transaction-lifecycle.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('a receipt callback cannot leave its durable attempt unsettled', async () =>
  withCheckInAttempt(async ({ f, run, attempt }) => {
    const store = attendanceEntrypoints({ run, nextId: createId });
    await assertRejects({
      given:
        'a receipt session whose application returns without applying or replaying',
      should:
        'refuse and roll back receipt writes while settling its attempt as aborted',
      code: 'CONFLICT',
      actual: () =>
        store.withAttendanceReceipt(
          {
            roundId: attempt.roundId,
            envelope: {
              version: 1,
              commandId: attempt.commandId,
              segmentId: createId(),
            },
            principal: { kind: 'human', actorId: attempt.actorId! },
            payloadDigest: attempt.payloadDigest,
          },
          async () => {},
        ),
    });
    const [row] = await f.sql`select
      (select count(*)::int from round_commands where command_id=${attempt.commandId}) as commands,
      (select count(*)::int from round_check_ins where command_id=${attempt.commandId}) as receipts,
      (select count(*)::int from round_check_in_attempts where command_id=${attempt.commandId} and state='pending') as pending,
      (select count(*)::int from round_check_in_attempts where command_id=${attempt.commandId} and state='aborted') as aborted`;
    assert({
      given: 'the refused unfinished session',
      should: 'persist only one aborted attempt',
      actual: { ...row },
      expected: { commands: 0, receipts: 0, pending: 0, aborted: 1 },
    });
  }));
