import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture, type Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import {
  usageStateSchema,
  usageSourceSchema,
  type UsageSource,
  type UsageState,
  type UsageCreditProvenance,
  type UsageProviderOutcome,
} from '@daisy/protocol/billing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261107080513_fair_midnight';
const scratch = scratchDatabase(databaseUrl, 'can7vbrip0jusage');
afterAll(() => scratch.drop());
const reservedAt = new Date('2026-10-31T23:59:58.000Z');
const countedAt = new Date('2026-10-31T23:59:59.000Z');
const restoredAt = new Date('2026-11-01T00:01:00.000Z');

async function seed(
  f: Fixture,
  mode: 'reserved' | 'released' | 'unknown' | 'refunded' | 'credited',
) {
  const terminal =
    mode === 'released' || mode === 'refunded' || mode === 'credited';
  const roundId = await f.round(
    terminal
      ? {
          status: 'abandoned',
          completed_at: restoredAt,
          ...(mode === 'credited' ? { platform_ending: 'recovery_bound' } : {}),
        }
      : {},
  );
  const actorId = await f.actor();
  const id = createId();
  const incidentId = mode === 'credited' ? createId() : null;
  if (incidentId)
    await f.insert('round_incidents', {
      id: incidentId,
      round_id: roundId,
      cause: 'vendor_unreachable',
      detected_at: countedAt,
      ended_at: restoredAt,
    });
  if (mode === 'refunded' || mode === 'credited') {
    const seat = await f.seat(roundId, 'affirmative');
    await f.insert('agent_runs', {
      id: createId(),
      round_participant_id: seat.id,
      kind: 'speech',
      provider: 'openrouter',
      configuration_snapshot: {
        providerOutcome: mode === 'credited' ? 'received' : 'failed',
      },
      requests: 1,
      input_tokens: mode === 'credited' ? 7 : 0,
      started_at: countedAt,
      ended_at: restoredAt,
    });
  }
  await f.insert('usage_reservations', {
    id,
    actor_id: actorId,
    round_id: roundId,
    kind: 'ai_round',
    reserved_at: reservedAt,
    counted_at: ['reserved', 'released'].includes(mode) ? null : countedAt,
    refunded_at: mode === 'refunded' || mode === 'credited' ? restoredAt : null,
  });
  return { id, mode, incidentId };
}

type MigrationResult = {
  mode: Parameters<typeof seed>[1];
  source: UsageSource;
  state: UsageState['kind'];
  count: string | null;
  credit: readonly [UsageCreditProvenance, UsageProviderOutcome] | null;
  originalTime: string;
  binding: boolean;
};

test(
  'the ledger migration preserves original beta periods and separates provider refunds from served platform credits',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const originals = [];
      for (const mode of [
        'reserved',
        'released',
        'unknown',
        'refunded',
        'credited',
      ] as const)
        originals.push(await seed(f, mode));
      await scratch.migrate(() => true);
      const actual: MigrationResult[] = [];
      for (const original of originals) {
        const [row] =
          await f.sql`select source,state,reserved_at,binds_free_judge from usage_reservations where id=${original.id}`;
        const source = usageSourceSchema.parse(row.source),
          state = usageStateSchema.parse(row.state);
        actual.push({
          mode: original.mode,
          source,
          state: state.kind,
          count:
            'countedAt' in state
              ? new Date(state.countedAt).toISOString()
              : null,
          credit:
            state.kind === 'credited'
              ? [state.provenance, state.providerOutcome]
              : null,
          originalTime: new Date(row.reserved_at).toISOString(),
          binding: row.binds_free_judge,
        });
      }
      assert({
        given:
          'populated predecessor rows spanning a month edge, including a received provider call credited by the platform',
        should:
          'retain original source, period and count; preserve non-dispatch, unknown, definite refund and platform provenance independently',
        actual,
        expected: originals.map((original): MigrationResult => ({
          mode: original.mode,
          source: {
            kind: 'beta',
            startsAt: '2026-10-01T00:00:00.000Z',
            endsAt: '2026-11-01T00:00:00.000Z',
          },
          state: original.mode,
          count: ['reserved', 'released'].includes(original.mode)
            ? null
            : countedAt.toISOString(),
          credit:
            original.mode === 'credited'
              ? [
                  { kind: 'recovery_bound', incidentId: original.incidentId! },
                  'delivered',
                ]
              : null,
          originalTime: reservedAt.toISOString(),
          binding: false,
        })),
      });
    });
  },
  ddlTimeoutMs,
);
