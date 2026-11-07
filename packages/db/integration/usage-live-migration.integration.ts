import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { testLane } from '../src/testing-lane';
import { rounds } from '../src/schema/rounds';
import { agentRuns } from '../src/schema/agent-runs';
import { readDatabaseTime } from '../src/database-clock';
import {
  lockBotAdmission,
  markLockedRoundBotModelCall,
} from '../src/round-bot-admission';
import { writeProjectionWithPhaseSignal } from '../src/round-projection-writer';
import { withFixture } from './constraint-helpers';
import { createBotSeat } from './bot-seat.test-support';
import { admissionSponsor } from './bot-admission.test-support';
import {
  scratchDatabase,
  ddlTimeoutMs,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const ledgerMigration = '20261105032232_conscious_spyke';
const originalAt = '2026-10-31T23:59:59.000Z';

for (const ending of ['ordinary', 'recovery_bound'] as const) {
  test(
    `live populated migration permits later unknown dispatch and ${ending} terminalization`,
    async () => {
      const scratch = scratchDatabase(databaseUrl, 'billinglive');
      await scratch.create();
      try {
        await scratch.migrate((folder) => folder < ledgerMigration);
        await withFixture(scratch.url, async (f) => {
          const roundId = await f.round({
            status: 'active',
            current_stage: 'live',
            started_at: new Date(originalAt),
          });
          const actorId = await admissionSponsor(f, [roundId]);
          const seat = await createBotSeat(f, roundId, 'affirmative');
          const reservationId = createId();
          await f.insert('usage_reservations', {
            id: reservationId,
            actor_id: actorId,
            round_id: roundId,
            kind: 'ai_round',
            reserved_at: new Date(originalAt),
            counted_at: new Date(originalAt),
          });
          await f.insert('agent_runs', {
            id: createId(),
            round_participant_id: seat.id,
            kind: 'speech',
            provider: 'fixture',
            requests: 1,
            input_tokens: 7,
            configuration_snapshot: { providerOutcome: 'received' },
            started_at: new Date(originalAt),
            ended_at: new Date(originalAt),
          });
          await scratch.migrate(() => true);
          const [migrated] =
            await f.sql`select source,state from usage_reservations where id=${reservationId}`;
          const client = new SQL(scratch.url, { max: 4 });
          const run = createBoundedTransaction({
            lane: testLane(client, 4),
            now: performance.now,
          });
          try {
            await run(async (tx) => {
              await lockBotAdmission(tx);
              await markLockedRoundBotModelCall(tx, {
                roundId,
                before: '2099-01-01T00:00:00.000Z',
                accountEligible: canUseAiAllowance,
              });
              await tx.insert(agentRuns).values({
                id: createId(),
                roundParticipantId: seat.id,
                kind: 'speech',
                provider: 'fixture',
                requests: 1,
                configurationSnapshot: { providerOutcome: 'unknown' },
                startedAt: await readDatabaseTime(tx),
              });
            });
            const incidentId = createId();
            if (ending === 'recovery_bound')
              await f.insert('round_incidents', {
                id: incidentId,
                round_id: roundId,
                cause: 'vendor_unreachable',
                detected_at: new Date(),
              });
            await run(async (tx) => {
              const [current] = await tx
                .select()
                .from(rounds)
                .where(eq(rounds.id, roundId))
                .for('no key update');
              const now = (await readDatabaseTime(tx)).toISOString();
              await writeProjectionWithPhaseSignal(
                tx,
                roundId,
                current!,
                {
                  round: {
                    status: 'abandoned',
                    currentStage: null,
                    startedAt: current!.startedAt!.toISOString(),
                    completedAt: now,
                    outcome: null,
                    checkpoint: current!.runtimeState as never,
                  },
                  segmentInserts: [],
                  segmentCloses: [],
                  effects: [],
                  ...(ending === 'recovery_bound'
                    ? { incidentChanges: [{ kind: 'ended' as const, at: now }] }
                    : {}),
                },
                now,
              );
            });
            const [after] = await f.sql`select r.status,u.source,u.state,
            (select sum(requests)::int from agent_runs where round_participant_id=${seat.id}) as requests,
            (select sum(input_tokens)::int from agent_runs where round_participant_id=${seat.id}) as tokens
            from usage_reservations u join rounds r on r.id=u.round_id where u.id=${reservationId}`;
            assert({
              given:
                'a live counted predecessor with a served call, migrated before a later unknown call',
              should:
                'commit the terminal Round while retaining original attribution, known served cost and unknown exposure',
              actual: {
                status: after.status,
                source: after.source,
                count: Date.parse(after.state.countedAt),
                state: after.state.kind,
                outcome: after.state.providerOutcome ?? after.state.kind,
                requests: after.requests,
                tokens: after.tokens,
              },
              expected: {
                status: 'abandoned',
                source: migrated.source,
                count: Date.parse(originalAt),
                state: ending === 'ordinary' ? 'unknown' : 'credited',
                outcome: 'unknown',
                requests: 2,
                tokens: 7,
              },
            });
          } finally {
            await client.close({ timeout: 0 });
          }
        });
      } finally {
        await scratch.drop();
      }
    },
    ddlTimeoutMs,
  );
}
