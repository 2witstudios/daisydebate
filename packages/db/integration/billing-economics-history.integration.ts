import {
  scratchDatabase,
  ddlTimeoutMs,
} from './scratch-migrations.test-support';
import { completedRound } from './round-analysis.test-support';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { createLane } from '../src/workload';
import { createBillingEconomicsReader } from '../src/billing-economics';
import { withFixture } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test(
  'historical analysis cannot inherit a later request source while actual received zero counters remain distinct from defaults',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'ec7vbrip0j');
    let pool: SQL | undefined;
    const instanceId = createId();
    try {
      await scratch.create();
      await scratch.migrate(
        (tag) => tag < '20261105082020_requested_round_analysis',
      );
      await withFixture(scratch.url, async (fixture) => {
        const round = await fixture.round();
        const { aff } = await completedRound(fixture, round, true);
        const [before] =
          await fixture.sql`select date_trunc('milliseconds',clock_timestamp()-interval '1 day') as at`;
        const created = (before!.at as Date).toISOString();
        await fixture.insert(
          'round_analyses',
          {
            round_id: round,
            round_participant_id: aff.id,
            freeze_revision: 1,
            status: 'leased',
            attempts: 1,
            model: 'original-historical',
            input_tokens: 100,
            output_tokens: 20,
            lease_token_digest: 'f'.repeat(64),
            lease_expires_at: new Date('2099-01-01T00:00:00.000Z'),
            created_at: created,
            completed_at: null,
          },
          'round_participant_id',
        );
        await scratch.migrate(() => true);
        const [row] =
          await fixture.sql`select work from round_analyses where round_participant_id=${aff.id}`;
        const historical = (row!.work as { historical: unknown }).historical;
        const [clock] =
          await fixture.sql`select date_trunc('milliseconds',clock_timestamp()) as at`;
        const requested = (clock!.at as Date).toISOString();
        const request = {
          requestId: createId(),
          requestedAt: requested,
          deadlineAt: new Date(Date.parse(requested) + 900000).toISOString(),
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
          expiresAt: new Date(Date.parse(requested) + 30000).toISOString(),
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
        pool = new SQL(scratch.url, { max: 6 });
        const db = createDatabase({
          url: scratch.url,
          client: pool,
          nextActorId: createId,
        });
        const run = createBoundedTransaction({
          lane: createLane('control', pool, {
            connections: 6,
            queue: 16,
            maxWaitMs: 1000,
          }),
          now: performance.now,
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
            'retain historical cost as unattributed, bind only the new request to its real source and distinguish positively received zero from default counters',
          actual: snapshot.attempts.map((a) => [
            a.model,
            a.provider,
            a.sourceKind,
            a.knownResponses,
            a.unknownCalls,
            a.inputTokens,
            a.outputTokens,
          ]),
          expected: [
            ['actual-new-model', 'openrouter', 'lifetime', 1, 0, 0, 0],
            [
              'original-historical',
              'unrecorded',
              'unattributed',
              1,
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
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);
