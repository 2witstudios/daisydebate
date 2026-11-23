import { createAvailabilityStore } from '../src/stores/availability';
import { createRoundMaintenanceStore } from '../src/stores/round-maintenance';
import { createRoundStore } from '../src/stores/rounds';
import { openDatabaseResources } from '../src/resources';
import { hostWaits } from '@daisy/worker/host';
import { roundDecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createBotSeat } from './bot-seat.test-support';
import { finishedOrBlockedBehind } from '../src/testing';
import type { SQL } from 'bun';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (
  options: Parameters<typeof openDatabaseResources>[0] & {
    readonly roundTime?: NonNullable<
      Parameters<typeof createRoundMaintenanceStore>[1]
    >['roundTime'];
    readonly decisionRelease?: NonNullable<
      Parameters<typeof createRoundMaintenanceStore>[1]
    >['decisionRelease'];
  },
) => {
  const resources = openDatabaseResources(options);
  return {
    ...createAvailabilityStore(resources),
    ...createRoundMaintenanceStore(resources, {
      roundTime: options.roundTime,
      decisionRelease: options.decisionRelease,
    }),
    ...createRoundStore(resources, {
      roundTime: options.roundTime,
      decisionRelease: options.decisionRelease,
    }),
    close: resources.close,
  };
};

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const maintenanceStore = (client: SQL) =>
  openStores({
    waits: hostWaits,
    decisionRelease: roundDecisionReleasePolicy,
    url: databaseUrl,
    client,
  });

test('maintenance discovery includes every cast without sessions and requires a current web principal', async () =>
  withBoundedRound(async (f, _run, humanRound, client) => {
    await f.seat(humanRound, 'affirmative');
    const botRound = await f.round();
    await createBotSeat(f, botRound, 'affirmative');
    const terminal = await f.round({
      status: 'abandoned',
      completed_at: new Date(),
    });
    await f.sql`update rounds set status='active',current_stage='live',started_at=clock_timestamp() where id in (${humanRound},${botRound})`;
    const store = maintenanceStore(client);
    const instanceId = createId();
    try {
      await assertRejects({
        given: 'an unknown service instance',
        should: 'refuse maintenance discovery',
        actual: () =>
          store.readRoundMaintenanceCandidates({
            instanceId,
            limit: 1,
          }),
        code: 'AUTHORIZATION',
      });
      await store.renewServiceInstance({ instanceId, role: 'web' });
      // Rounds the clock can move include the fixture's own opening Round.
      await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where status='opening'`;
      const first = await store.readRoundMaintenanceCandidates({
        instanceId,
        limit: 1,
      });
      const second = await store.readRoundMaintenanceCandidates({
        instanceId,
        limit: 1,
        afterId: first.afterId!,
      });
      const last = await store.readRoundMaintenanceCandidates({
        instanceId,
        limit: 1,
        afterId: second.afterId!,
      });
      assert({
        given:
          'active human-only and bot Rounds without any media session, plus a terminal Round',
        should: 'discover both active casts in stable keyset pages only',
        actual: {
          ids: [...first.roundIds, ...second.roundIds],
          exhausted: last.exhausted,
          terminal: [...first.roundIds, ...second.roundIds].includes(terminal),
        },
        expected: {
          ids: [humanRound, botRound].sort(),
          exhausted: true,
          terminal: false,
        },
      });
      await f.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
      await assertRejects({
        given: 'a stale durable web instance',
        should: 'refuse another discovery page',
        actual: () =>
          store.readRoundMaintenanceCandidates({
            instanceId,
            limit: 1,
          }),
        code: 'AUTHORIZATION',
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));

test('discovery reports an opening that waits on the clock, so the loop keeps its pace (ADR 0154)', async () =>
  withBoundedRound(async (f, _run, _round, client) => {
    const store = maintenanceStore(client);
    const instanceId = createId();
    await store.renewServiceInstance({ instanceId, role: 'web' });
    try {
      await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where status in ('opening','active')`;
      // An opening without a Room is no Room's countdown: it never counts.
      await f.round();
      const none = await store.readRoundMaintenanceCandidates({
        instanceId,
        limit: 8,
      });
      const host = await f.actor();
      const room = await f.room(host, await f.format());
      const waiting = await f.round({
        room_id: room,
        room_config_snapshot: {},
        visibility: 'public',
        pre_round_prep_ms: 3_600_000,
      });
      const pending = await store.readRoundMaintenanceCandidates({
        instanceId,
        limit: 8,
      });
      assert({
        given:
          'an opening without a Room, then one with a Room an hour from its prep end',
        should:
          'report no opening waiting, then one waiting that is not yet a due candidate',
        actual: {
          none: none.openingsWaiting,
          pending: pending.openingsWaiting,
          due: pending.roundIds.includes(waiting),
        },
        expected: { none: false, pending: true, due: false },
      });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));

test('maintenance rechecks service authority after a competing Round lock before invoking the engine', async () =>
  withBoundedRound(async (f, _run, roundId, client) => {
    const store = maintenanceStore(client),
      instanceId = createId();
    const holder = await f.sql.reserve();
    let pending: Promise<unknown> | undefined,
      projections = 0;
    const before = await store.getRound(roundId);
    try {
      await store.renewServiceInstance({ instanceId, role: 'web' });
      await holder`begin`;
      const [backend] = await holder`select pg_backend_pid() as pid`;
      await holder`select id from rounds where id=${roundId} for no key update`;
      pending = store.tickDueRound({
        instanceId,
        roundId,
        buildProjection: () => {
          projections += 1;
          throw new Error('Expired authority reached projection');
        },
      });
      const refused = assertRejects({
        given: 'a service that expires while waiting for Round ownership',
        should: 'refuse before any shared engine projection',
        actual: () => pending!,
        code: 'AUTHORIZATION',
      });
      const blocked = await finishedOrBlockedBehind(
        pending,
        f.sql,
        backend.pid,
        { waits: hostWaits, deadlineMs: 800 },
      );
      await f.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
      await holder`commit`;
      await refused;
      assert({
        given: 'authority changed during the actual lock wait',
        should: 'retain the complete Round state and never run the callback',
        actual: { blocked, projections, round: await store.getRound(roundId) },
        expected: { blocked: 'blocked', projections: 0, round: before },
      });
    } finally {
      await holder`rollback`;
      holder.release();
      if (pending) await Promise.allSettled([pending]);
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));
