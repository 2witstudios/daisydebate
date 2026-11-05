import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withRoomRuntime } from './room-runtime.test-support';

setupRitewayBun();
const selection = {
  kind: 'catalog',
  formatId: 'value',
  formatVersion: 1,
  presetVersion: 1,
  competitionType: 'casual',
} as const;
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

async function paidGrant(f: Fixture, entitlement = 'casual_ai_judge') {
  await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId}`;
  await f.sql`insert into account_entitlement_grants(user_id,entitlement,source,starts_at,expires_at)
    values(${f.host.userId},${entitlement},'subscription',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '600 milliseconds')`;
}

/** Release a real SQL barrier only after observing both its waiter and the unchanged grant's expiry. */
async function acrossExpiry(
  f: Fixture,
  lock: (
    blocker: Awaited<ReturnType<Fixture['sql']['reserve']>>,
  ) => Promise<unknown>,
  attempt: () => Promise<unknown>,
  reason: 'ai-judge-premium' | 'capture-premium' = 'ai-judge-premium',
) {
  const blocker = await f.sql.reserve();
  let result: Promise<unknown> | undefined;
  try {
    await blocker`begin`;
    await lock(blocker);
    const [{ pid }] = await blocker`select pg_backend_pid() as pid`;
    result = attempt();
    const observed = Promise.allSettled([result]);
    let waiting = false;
    for (let count = 0; count < 200 && !waiting; count++) {
      const [row] = await f.sql`select exists(select 1 from pg_stat_activity
        where datname=current_database() and ${pid}=any(pg_blocking_pids(pid))) as waiting`;
      waiting = row.waiting;
      if (!waiting) await Bun.sleep(5);
    }
    const [edge] = await blocker`select clock_timestamp()<expires_at as before
      from account_entitlement_grants where user_id=${f.host.userId}`;
    assert({
      given: 'an admission blocked in PostgreSQL on required entitlement facts',
      should: 'actually wait while the unchanged paid grant is valid',
      actual: [waiting, edge.before],
      expected: [true, true],
    });
    await blocker`select pg_sleep(greatest(0,extract(epoch from expires_at-clock_timestamp()))+0.01)
      from account_entitlement_grants where user_id=${f.host.userId}`;
    await blocker`commit`;
    await observed;
    await assertRejects({
      given: 'paid access expires before the required SQL wait finishes',
      should: 'refuse the mutation using post-wait time',
      actual: () => result!,
      code: 'CONFLICT',
      reason,
    });
  } finally {
    await blocker`rollback`;
    blocker.release();
    await result?.catch(() => undefined);
  }
}

test('Room creation does not reuse creation time after an initial-cast profile lock wait', async () => {
  await withRoomRuntime(async (f) => {
    const judge = await f.aiJudge();
    await paidGrant(f);
    await acrossExpiry(
      f,
      (tx) =>
        tx`select actor_id from ai_judge_profiles where actor_id=${judge.actorId} for update`,
      () =>
        f.create({
          selection,
          cast: [{ actorId: judge.actorId, role: 'judge', slot: 0 }],
        }),
    );
    const [rows] = await f.sql`select
      (select count(*)::int from rooms where host_actor_id=${f.host.actorId}) rooms,
      (select count(*)::int from room_commands where actor_id=${f.host.actorId}) commands,
      (select count(*)::int from room_participants where actor_id=${judge.actorId}) seats`;
    assert({
      given: 'the initial cast was refused after paid expiry',
      should: 'roll back the Room, seats and command receipt',
      actual: rows,
      expected: { rooms: 0, commands: 0, seats: 0 },
    });
  });
});

test('Room commands evaluate paid access after their blocked grant read', async () => {
  await withRoomRuntime(async (f) => {
    const { view } = await f.create({ selection });
    const judge = await f.aiJudge();
    const before = await f.snapshot(view.id);
    await paidGrant(f);
    await acrossExpiry(
      f,
      (tx) =>
        tx`lock table account_entitlement_grants in access exclusive mode`,
      () =>
        f.command(f.host, view, {
          type: 'assign-seat',
          actorId: judge.actorId,
          role: 'judge',
          slot: 0,
        }),
    );
    assert({
      given: 'the command was refused after paid expiry',
      should:
        'leave Room versions, participants, receipts, Rounds and outbox unchanged',
      actual: await f.snapshot(view.id),
      expected: before,
    });
  });
});

test('casual capture admission refuses expiry after a blocked grant read', async () => {
  await withRoomRuntime(async (f) => {
    const { view } = await f.create();
    const before = await f.snapshot(view.id);
    await paidGrant(f, 'casual_capture');
    await acrossExpiry(
      f,
      (tx) =>
        tx`lock table account_entitlement_grants in access exclusive mode`,
      () =>
        f.command(f.host, view, {
          type: 'set-capture',
          capture: { broadcast: null, recording: true },
        }),
      'capture-premium',
    );
    assert({
      given: 'capture access expired while its grant query waited',
      should: 'refuse capture without changing Room state, receipts or outbox',
      actual: await f.snapshot(view.id),
      expected: before,
    });
  });
});
