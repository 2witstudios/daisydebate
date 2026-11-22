import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  createAttendanceOperations,
  type AttendanceReceiptSession,
} from '../src/attendance-operations';
import { withFixture } from './constraint-helpers';
import { validRules } from './round-fixtures';
import { createAuthorizationSubject } from './authorization.test-support';
import { attendanceEntrypoints } from '../src/attendance-entrypoints';
import { withCheckInAttempt } from './bounded-transaction-lifecycle.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

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

test('receipt closure survives delayed real persistence during transaction cleanup', async () =>
  withFixture(databaseUrl, async (f) => {
    const { actorId } = await createAuthorizationSubject(f);
    const {
      id: roundId,
      seats: [seat],
    } = await f.roundWithCast(
      {
        status: 'active',
        current_stage: 'live',
        started_at: new Date('2026-10-22T00:00:00Z'),
      },
      [{ seat: 'affirmative', actorId }],
    );
    if (!seat) throw new Error('Attendance seat required');
    const segmentId = createId();
    const rule = validRules.segments.find((s) => s.type === 'speech');
    if (!rule) throw new Error('Speech rule required');
    await f.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: rule.key,
      duration_ms: rule.durationMs,
      started_at: new Date('2026-10-22T00:00:00Z'),
      ended_at: new Date('2026-10-22T00:04:00Z'),
    });
    const db = drizzle({ client: f.sql });
    let pending: Promise<void> | undefined;
    let released: AttendanceReceiptSession | undefined;
    const store = createAttendanceOperations({
      nextAttemptId: createId,
      verifyWorker: async () => {
        throw new Error('Human fixture');
      },
      run: (work) =>
        db.transaction(async (tx) => {
          try {
            return await work(tx, {
              receivedAt: '2026-10-22T00:00:00.123456Z',
            });
          } catch (error) {
            // Keep real SQL alive through asynchronous cleanup; session release must be independent.
            if (pending && released) {
              await Promise.allSettled([pending]);
              const session = released;
              await assertRejects({
                given:
                  'the apply completes after its callback has released the session',
                should:
                  'keep reads closed even before transaction cleanup finishes',
                actual: () => session.readClosedSegments(),
                code: 'CONFLICT',
              });
            }
            throw error;
          }
        }),
    });
    const input = () => ({
      roundId,
      principal: { kind: 'human' as const, actorId },
      envelope: { version: 1 as const, commandId: createId(), segmentId },
      payloadDigest: 'a'.repeat(64),
    });
    for (const kind of ['first fact', 'fresh alias'] as const) {
      if (kind === 'fresh alias') {
        await store.withAttendanceReceipt(input(), async (session) => {
          await session.prepare(seat.id);
          await session.apply();
        });
      }
      const request = input();
      await assertRejects({
        given: kind + ' apply started without awaiting completion',
        should: 'roll back the unsettled callback',
        code: 'CONFLICT',
        actual: () =>
          store.withAttendanceReceipt(request, async (session) => {
            released = session;
            await session.prepare(seat.id);
            pending = session.apply();
            void pending.catch(() => {});
          }),
      });
      pending = undefined;
      released = undefined;
      const [row] = await f.sql`select
        (select count(*)::int from round_commands where command_id=${request.envelope.commandId}) as aliases,
        (select count(*)::int from round_check_ins where command_id=${request.envelope.commandId}) as facts`;
      assert({
        given: kind + ' escaped apply',
        should: 'leave neither alias nor fact',
        actual: { ...row },
        expected: { aliases: 0, facts: 0 },
      });
    }
  }));
