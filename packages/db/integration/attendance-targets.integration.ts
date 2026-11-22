import { createAppError } from '@daisy/errors';
import { eligibleCompetitorIds } from '@daisy/protocol/seats';
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
    const { userId, actorId } = await createAuthorizationSubject(fixture);
    const {
      id: roundId,
      seats: [seat],
    } = await fixture.roundWithCast(
      {
        status: 'active',
        current_stage: 'live',
        started_at: new Date('2026-10-22T00:00:00Z'),
      },
      [{ seat: 'affirmative', actorId }],
    );
    if (!seat) throw new Error('Initial attendance seat missing');
    const db = drizzle({ client: fixture.sql });
    const store = createAttendanceOperations({
      nextAttemptId: createId,
      verifyWorker: async () => {
        throw new Error('Human fixture cannot enter bot verifier');
      },
      run: (work) =>
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
    // Adapter proof: the trusted caller supplies canonical admission; no product seat/window policy is defined here.
    const read = () =>
      store.withAttendanceDiscovery({ roundId, principal }, async (session) => {
        const access = session.authority.principalAccess;
        if (!access || !admitsPrincipalAccess(access))
          throw createAppError('AUTHORIZATION');
        const seats = await session.readSeats();
        return {
          round: session.authority.round,
          participantId: seat.id,
          eligibleParticipantIds: eligibleCompetitorIds(seats),
          ...(await session.readRecorded(seat.id)),
          finalizedSegmentIds: await session.readAdjudicatedSegments(),
        };
      });
    const facts = await read();
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
    await fixture.sql`update users set deleted_at=statement_timestamp() where id=${userId}`;
    await assertRejects({
      given: 'same cached principal after canonical erasure',
      should: 'refuse target discovery from fresh account facts',
      actual: () => read(),
      code: 'AUTHORIZATION',
    });
  });
});
