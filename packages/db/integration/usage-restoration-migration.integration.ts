import { readFile } from 'node:fs/promises';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { usageStateSchema, usageSourceSchema } from '@daisy/protocol/billing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assertRejects } from '@daisy/errors/testing';
import { advanceUsageLocked } from '../src/usage-ledger';
import { refundUnservedPracticeLocked } from '../src/round-usage-settlement';
import { withFixture, type Fixture } from './constraint-helpers';
import {
  scratchDatabase,
  ddlTimeoutMs,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261105032232_conscious_spyke';
const repair = new URL(
  '../migrations/20261105041923_billing_usage_restoration/migration.sql',
  import.meta.url,
);
const reservedAt = '2026-10-31T23:59:58.000Z';
const countedAt = '2026-10-31T23:59:59.000Z';
const restoredAt = '2026-11-01T00:01:00.000Z';
const modes = [
  'absent',
  'unknown',
  'missing_provenance',
  'capture_shortfall',
  'live_received',
  'proven_failure',
] as const;
type Mode = (typeof modes)[number];

async function seed(f: Fixture, mode: Mode) {
  const roundId = await f.round(
    mode === 'live_received'
      ? {
          status: 'active',
          current_stage: 'live',
          started_at: new Date(countedAt),
        }
      : {
          status: mode === 'capture_shortfall' ? 'completed' : 'abandoned',
          completed_at: new Date(restoredAt),
          ...(mode === 'capture_shortfall'
            ? {
                platform_ending: 'capture_shortfall',
                started_at: new Date(countedAt),
              }
            : {}),
          ...(mode === 'missing_provenance'
            ? { platform_ending: 'recovery_bound' }
            : {}),
        },
  );
  const actorId = await f.actor();
  const id = createId(),
    runId = createId(),
    commandId = createId();
  const seat = await f.seat(roundId, 'affirmative');
  if (mode !== 'absent')
    await f.insert('agent_runs', {
      id: runId,
      round_participant_id: seat.id,
      kind: 'speech',
      provider: 'fixture',
      requests: 1,
      input_tokens: ['capture_shortfall', 'live_received'].includes(mode)
        ? 7
        : 0,
      configuration_snapshot: {
        providerOutcome:
          mode === 'proven_failure'
            ? 'failed'
            : ['capture_shortfall', 'live_received'].includes(mode)
              ? 'received'
              : 'unknown',
      },
      started_at: new Date(countedAt),
      ended_at: new Date(restoredAt),
    });
  if (mode === 'capture_shortfall') {
    await f.insert(
      'round_commands',
      {
        command_id: commandId,
        round_id: roundId,
        actor_id: actorId,
        type: 'complete',
        payload_digest: 'a'.repeat(64),
        result: {},
        resulting_version: 1,
        applied_at: new Date(restoredAt),
      },
      'command_id',
    );
    await f.insert(
      'round_transcript_freezes',
      {
        round_id: roundId,
        revision: 1,
        frontier: 0,
        completeness: 'incomplete',
      },
      'round_id',
    );
    await f.insert(
      'round_finalizations',
      {
        round_id: roundId,
        command_id: commandId,
        resulting_version: 1,
        freeze_revision: 1,
      },
      'round_id',
    );
  }
  await f.insert('usage_reservations', {
    id,
    actor_id: actorId,
    round_id: roundId,
    kind: 'ai_round',
    reserved_at: new Date(reservedAt),
    counted_at: new Date(countedAt),
    refunded_at: new Date(restoredAt),
  });
  return { id, roundId, actorId, runId, commandId, mode };
}

test(
  'forward repair preserves ambiguous recorded relief, proven capture provenance and later evidence',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'billingrestoration');
    await scratch.create();
    try {
      await scratch.migrate((folder) => folder < migration);
      await withFixture(scratch.url, async (f) => {
        const originals = [];
        try {
          for (const mode of modes) originals.push(await seed(f, mode));
          await scratch.migrate((folder) => folder <= migration);
          const read =
            () => f.sql`select id,actor_id,round_id,kind,source,state,reserved_at,binds_free_judge,binding_released_at
          from usage_reservations order by id`;
          const before = await read();
          await scratch.migrate(
            (folder) => folder <= '20261105041923_billing_usage_restoration',
          );
          const repaired = await read();
          // Execute the actual repair body again (not the migration journal's no-op).
          const statements = (await readFile(repair, 'utf8')).split(
            '--> statement-breakpoint',
          );
          await f.sql.begin(async (tx) => {
            for (const statement of statements)
              if (statement.trim()) await tx.unsafe(statement);
          });
          assert({
            given:
              'the same durable facts on a second execution of the forward repair',
            should: 'leave all already-correct rows byte-for-byte unchanged',
            actual: await read(),
            expected: repaired,
          });

          await scratch.migrate(() => true);
          const after = await read();
          assert({
            given:
              'all permitted predecessor refund cases, with missing, unknown, proven failed and served provider evidence',
            should:
              'preserve identity/source/period/admission/count/restoration and truthfully separate prior relief from provider failure',
            actual: originals.map((original) => {
              const row = after.find(
                (r: { id: string }) => r.id === original.id,
              )!;
              const previous = before.find(
                (r: { id: string }) => r.id === original.id,
              )!;
              const state = usageStateSchema.parse(row.state);
              return [
                original.mode,
                { ...row, state: null },
                { ...previous, state: null },
                usageSourceSchema.parse(row.source),
                state.kind,
                'countedAt' in state ? Date.parse(state.countedAt) : null,
                'countBasis' in state ? state.countBasis : null,
                state.kind === 'credited'
                  ? [
                      Date.parse(state.creditedAt),
                      state.provenance,
                      state.providerOutcome,
                    ]
                  : state.kind === 'refunded'
                    ? Date.parse(state.refundedAt)
                    : null,
              ];
            }),
            expected: originals.map((original) => {
              const previous = before.find(
                (r: { id: string }) => r.id === original.id,
              )!;
              return [
                original.mode,
                { ...previous, state: null },
                { ...previous, state: null },
                {
                  kind: 'beta',
                  startsAt: '2026-10-01T00:00:00.000Z',
                  endsAt: '2026-11-01T00:00:00.000Z',
                },
                original.mode === 'proven_failure' ? 'refunded' : 'credited',
                Date.parse(countedAt),
                'dispatch_record',
                original.mode === 'proven_failure'
                  ? Date.parse(restoredAt)
                  : [
                      Date.parse(restoredAt),
                      original.mode === 'capture_shortfall'
                        ? {
                            kind: 'capture_shortfall',
                            commandId: original.commandId,
                            freezeRevision: 1,
                          }
                        : { kind: 'recorded_restoration' },
                      original.mode === 'capture_shortfall'
                        ? 'delivered'
                        : 'unknown',
                    ],
              ];
            }),
          });
          const database = drizzle({ client: f.sql });
          for (const original of originals.filter(
            (o) => o.mode !== 'proven_failure',
          )) {
            await assertRejects({
              given: `restored ${original.mode} usage with current dispatch authority`,
              should: 'refuse reuse of the restored identity',
              code: 'CONFLICT',
              actual: () =>
                database.transaction((tx) =>
                  advanceUsageLocked(tx, {
                    reservationId: original.id,
                    actorId: original.actorId,
                    roundId: original.roundId,
                    authorized: true,
                    event: {
                      kind: 'dispatch',
                      before: '2099-01-01T00:00:00.000Z',
                    },
                  }),
                ),
            });
          }
          const late = originals.find((o) => o.mode === 'unknown')!;
          const settle = () =>
            database.transaction(async (tx) => {
              await tx.execute(
                sql`select id from rounds where id=${late.roundId} for update`,
              );
              await refundUnservedPracticeLocked(tx, late.roundId);
            });
          await settle();
          await f.sql`update agent_runs set configuration_snapshot=${{ providerOutcome: 'received' }},input_tokens=7 where id=${late.runId}`;
          await settle();
          await settle();
          const [resolved] =
            await f.sql`select state from usage_reservations where id=${late.id}`;
          const initial = after.find((r: { id: string }) => r.id === late.id)!;
          assert({
            given:
              'unknown historical restoration followed by a late served call and duplicate settlement',
            should:
              'retain exactly one relief, original count/provenance/time and resolve the real provider evidence',
            actual: resolved.state,
            expected: { ...initial.state, providerOutcome: 'delivered' },
          });
          const [guard] =
            await f.sql`select tgenabled from pg_trigger where tgname='usage_attribution_immutable'`;
          assert({
            given: 'the completed forward correction and repeated repair',
            should: 'restore the runtime immutable trigger',
            actual: guard.tgenabled,
            expected: 'O',
          });
        } finally {
          for (const row of originals)
            await f.sql`delete from round_finalizations where round_id=${row.roundId}`;
        }
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);
