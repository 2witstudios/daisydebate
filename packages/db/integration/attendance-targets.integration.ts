import { assert, setupRitewayBun, test } from 'riteway/bun';
import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createAttendanceOperations } from '../src/attendance-operations';
import { withFixture } from './constraint-helpers';
import { validRules } from './round-fixtures';
import { createAuthorizationSubject } from './authorization.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('target discovery authenticates fresh seats and returns actual unresolved historical speech', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-22T00:00:00Z'),
    });
    const { userId, actorId } = await createAuthorizationSubject(fixture);
    const seat = await fixture.seat(roundId, 'affirmative', 0, actorId);
    const db = drizzle({ client: fixture.sql });
    const store = createAttendanceOperations({
      nextAttemptId: createId,
      verifyWorker: async () => {
        throw new Error('Human fixture cannot enter bot verifier');
      },
      transaction: (work) =>
        db.transaction((tx) =>
          work(tx, { receivedAt: '2026-10-22T00:00:00.000000Z' }),
        ),
    });
    const segmentId = createId();
    const rule = validRules.segments.find((s) => s.type === 'speech')!;
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: rule.key,
      duration_ms: rule.durationMs,
      started_at: new Date('2026-10-22T00:00:00Z'),
      ended_at: new Date('2026-10-22T00:04:00Z'),
    });
    const principal = { kind: 'human', actorId: seat.actorId } as const;
    const facts = await store.readRoundAttendanceTargets({
      roundId,
      principal,
      admits: admitsPrincipalAccess,
    });
    assert({
      given: 'actual closed speech without a receipt or resolution',
      should:
        'preserve historical target and fresh eligible seat without media hints',
      actual: [
        facts.round.segments.map((s) => s.id),
        facts.participantId,
        facts.eligibleParticipantIds,
        facts.receipts,
        facts.finalizedSegmentIds,
      ],
      expected: [[segmentId], seat.id, [seat.id], [], []],
    });
    await fixture.sql`update users set deleted_at=statement_timestamp(),username=null where id=${userId}`;
    await assertRejects({
      given: 'same cached principal after canonical erasure',
      should: 'refuse target discovery from fresh account facts',
      actual: () =>
        store.readRoundAttendanceTargets({
          roundId,
          principal,
          admits: admitsPrincipalAccess,
        }),
      code: 'AUTHORIZATION',
    });
  });
});
