import { createAvailabilityStore } from '../src/stores/availability';
import { openDatabaseResources } from '../src/resources';
import { hostWaits } from '@daisy/worker/host';
import { addMs } from '@daisy/clock';
import { completedRound } from './round-analysis.test-support';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { createLane } from '../src/workload';
import { createBillingEconomicsReader } from '../src/billing-economics';
import { withFixture } from './constraint-helpers';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (options: Parameters<typeof openDatabaseResources>[0]) => {
  const resources = openDatabaseResources(options);
  return {
    ...createAvailabilityStore(resources),
    close: resources.close,
  };
};

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('historical analysis cannot inherit a later request source and received outcomes remain distinct from token knowledge', async () => {
  let pool: SQL | undefined;
  const instanceId = createId();
  try {
    await withFixture(databaseUrl, async (fixture) => {
      const round = await fixture.round();
      const { aff } = await completedRound(fixture, round, true);
      const [before] =
        await fixture.sql`select date_trunc('milliseconds',clock_timestamp()-interval '1 day') as at`;
      const created = (before!.at as Date).toISOString();
      // A stored row carrying the usage observed before analysis requests
      // were recorded. guard_analysis_identity refuses to insert one today
      // (historical observations are immutable), so it is seeded with
      // triggers off; every CHECK still applies.
      const historicalWork = {
        kind: 'unrequested',
        historical: {
          createdAt: created,
          completedAt: null,
          claimedAttempts: 1,
          model: 'original-historical',
          inputTokens: 100,
          outputTokens: 20,
        },
      };
      await fixture.sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`insert into round_analyses(round_id,round_participant_id,freeze_revision,created_at,work)
            values(${round},${aff.id},1,${created}::timestamptz,${JSON.stringify(historicalWork)}::text::jsonb)`;
      });
      const [row] =
        await fixture.sql`select work from round_analyses where round_participant_id=${aff.id}`;
      const historical = (row!.work as { historical: unknown }).historical;
      const [clock] =
        await fixture.sql`select date_trunc('milliseconds',clock_timestamp()) as at`;
      const requested = (clock!.at as Date).toISOString();
      const request = {
        requestId: createId(),
        requestedAt: requested,
        deadlineAt: addMs(requested, 900000),
        evidenceLines: 2,
        claims: 0,
        calls: [] as unknown[],
      };
      await fixture.sql`update round_analyses set work=${JSON.stringify({ kind: 'queued', historical, ...request })}::text::jsonb where round_participant_id=${aff.id}`;
      const lease = {
        callId: createId(),
        tokenDigest: 'a'.repeat(64),
        model: 'actual-new-model',
        claimedAt: requested,
        expiresAt: addMs(requested, 30000),
      };
      const claimed = { ...request, claims: 1 };
      await fixture.sql`update round_analyses set work=${JSON.stringify({ kind: 'leased', historical, ...claimed, lease })}::text::jsonb where round_participant_id=${aff.id}`;
      const [dispatch] =
        await fixture.sql`select date_trunc('milliseconds',clock_timestamp()) as at`;
      const dispatched = (dispatch!.at as Date).toISOString();
      const call = {
        id: lease.callId,
        tokenDigest: lease.tokenDigest,
        model: lease.model,
        dispatchedAt: dispatched,
        outcome: { kind: 'unknown' },
      };
      await fixture.sql`update round_analyses set work=${JSON.stringify({ kind: 'leased', historical, ...claimed, lease, calls: [call] })}::text::jsonb where round_participant_id=${aff.id}`;
      await fixture.sql`update round_analyses set work=${JSON.stringify({ kind: 'leased', historical, ...claimed, lease, calls: [{ ...call, outcome: { kind: 'received', inputTokens: 0, outputTokens: 0 } }] })}::text::jsonb where round_participant_id=${aff.id}`;
      await fixture.insert('usage_reservations', {
        id: createId(),
        actor_id: aff.actorId,
        round_id: round,
        kind: 'round_analysis',
        source: { kind: 'lifetime' },
        state: {
          kind: 'delivered',
          countedAt: dispatched,
          countBasis: 'dispatch_record',
        },
        reserved_at: requested,
      });
      pool = new SQL(databaseUrl, { max: 6 });
      const db = openStores({
        waits: hostWaits,
        url: databaseUrl,
        client: pool,
      });
      const run = createBoundedTransaction({
        lane: createLane(
          'control',
          pool,
          {
            connections: 6,
            queue: 16,
            maxWaitMs: 1000,
          },
          { waits: hostWaits },
        ),
        waits: hostWaits,
      });
      await db.renewServiceInstance({ instanceId, role: 'web' });
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const c = await reserve(options);
        await c`set role daisy_web`;
        return c;
      };
      const startsAt = `${requested.slice(0, 7)}-01T00:00:00.000Z`,
        end = new Date(startsAt);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const snapshot = await createBillingEconomicsReader({
        run,
        instanceId,
      }).read({ startsAt, endsAt: end.toISOString() });
      assert({
        given:
          'a real populated predecessor migration with historical usage and then a separate guarded lifetime request/lease/dispatch/received-zero transition',
        should:
          'retain historical cost as unattributed and the new request source, while keeping received response outcomes separate from unmeasured zero token pairs',
        actual: snapshot.attempts.map((a) => [
          a.model,
          a.provider,
          a.sourceKind,
          a.knownResponses,
          a.unmeasuredResponses,
          a.unknownCalls,
          a.inputTokens,
          a.outputTokens,
        ]),
        expected: [
          ['actual-new-model', 'openrouter', 'lifetime', 1, 1, 0, 0, 0],
          [
            'original-historical',
            'unrecorded',
            'unattributed',
            1,
            0,
            0,
            100,
            20,
          ],
        ],
      });
      await pool.close({ timeout: 0 });
      pool = undefined;
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
    });
  } finally {
    await pool?.close({ timeout: 0 });
  }
}, 30_000);
