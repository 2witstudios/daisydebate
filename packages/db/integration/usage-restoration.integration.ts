import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refundUnservedPracticeLocked } from '../src/round-usage-settlement';
import { advanceUsageLocked } from '../src/usage-ledger';
import { sqlStateOf, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const countedAt = '2026-10-31T23:59:59.000Z';
const creditedAt = '2026-11-01T00:01:00.000Z';

test('a credited reservation with an unknown provider call refuses reuse, resolves a late served call once, and keeps its attribution', async () => {
  await withFixture(databaseUrl, async (f) => {
    const roundId = await f.round();
    const actorId = await f.actor();
    const seat = await f.seat(roundId, 'affirmative');
    await f.sql`update rounds set status='abandoned', completed_at=${new Date(creditedAt)},
      platform_ending='recovery_bound' where id=${roundId}`;
    const incidentId = createId();
    await f.insert('round_incidents', {
      id: incidentId,
      round_id: roundId,
      cause: 'vendor_unreachable',
      detected_at: new Date(countedAt),
      ended_at: new Date(creditedAt),
    });
    const runId = createId();
    await f.insert('agent_runs', {
      id: runId,
      round_participant_id: seat.id,
      kind: 'speech',
      provider: 'fixture',
      requests: 1,
      input_tokens: 0,
      configuration_snapshot: { providerOutcome: 'unknown' },
      started_at: new Date(countedAt),
      ended_at: new Date(creditedAt),
    });
    const id = createId();
    const credited = {
      kind: 'credited',
      countedAt,
      countBasis: 'dispatch_record',
      creditedAt,
      provenance: { kind: 'recovery_bound', incidentId },
      providerOutcome: 'unknown',
    };
    await f.insert('usage_reservations', {
      id,
      actor_id: actorId,
      round_id: roundId,
      kind: 'ai_round',
      reserved_at: new Date(countedAt),
      source: {
        kind: 'beta',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
      },
      state: credited,
    });
    const database = drizzle({ client: f.sql });
    await assertRejects({
      given: 'credited usage with current dispatch authority',
      should: 'refuse reuse of the restored identity',
      code: 'CONFLICT',
      actual: () =>
        database.transaction((tx) =>
          advanceUsageLocked(tx, {
            reservationId: id,
            actorId,
            roundId,
            authorized: true,
            event: { kind: 'dispatch', before: '2099-01-01T00:00:00.000Z' },
          }),
        ),
    });
    const settle = () =>
      database.transaction(async (tx) => {
        await tx.execute(
          sql`select id from rounds where id=${roundId} for update`,
        );
        await refundUnservedPracticeLocked(tx, roundId);
      });
    await settle();
    await f.sql`update agent_runs set configuration_snapshot=${{ providerOutcome: 'received' }},input_tokens=7 where id=${runId}`;
    await settle();
    await settle();
    const [resolved] =
      await f.sql`select state from usage_reservations where id=${id}`;
    assert({
      given:
        'that credit followed by a late served call and duplicate settlement',
      should:
        'retain exactly one relief, its count, provenance and time, and resolve the real provider evidence',
      actual: resolved.state,
      expected: { ...credited, providerOutcome: 'delivered' },
    });
    assert({
      given: 'the runtime role rewriting the reservation’s source',
      should: 'refuse it with the attribution guard',
      actual: await sqlStateOf(() =>
        f.sql.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`update usage_reservations set source='{"kind":"lifetime"}'::jsonb where id=${id}`;
        }),
      ),
      expected: '23514',
    });
  });
});
