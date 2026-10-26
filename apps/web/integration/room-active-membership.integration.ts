import { requireTestServices } from '@daisy/config';
import { expireIdleRoom } from '@daisy/debate-engine';
import { isAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const memberships = async (f: Fixture, actorIds: readonly string[]) =>
  (
    await f.sql<{ actor_id: string; room_id: string }[]>`
      select actor_id, room_id from room_active_memberships
      where actor_id in ${f.sql(actorIds)} order by actor_id`
  ).map((row) => [row.actor_id, row.room_id]);
const refusal = (outcome: PromiseSettledResult<unknown>) =>
  outcome.status === 'fulfilled'
    ? 'accepted'
    : isAppError(outcome.reason)
      ? outcome.reason.message
      : 'unexpected';

test('a second create or join is refused while another Room holds the user, leaving every state unchanged', async () => {
  await withRoomRuntime(async (f) => {
    const first = (await f.create()).view;
    const before = await f.snapshot(first.id);
    await assertRejects({
      given: 'a host whose assembling Room holds them',
      should: 'refuse a second create',
      actual: () => f.create(),
      code: 'CONFLICT',
    });
    const guestRoom = (await f.create({}, f.guest)).view;
    const guestBefore = await f.snapshot(guestRoom.id);
    await assertRejects({
      given: 'a host claiming a seat in another Room',
      should: 'refuse the join',
      actual: () =>
        f.command(f.host, guestRoom, {
          type: 'claim-seat',
          role: 'affirmative',
          slot: 0,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused create and the refused join',
      should:
        'keep both Rooms exactly as they were and the host in their own Room',
      actual: [
        await f.snapshot(first.id),
        await f.snapshot(guestRoom.id),
        await f.operations.activeRoom(f.host),
      ],
      expected: [
        before,
        guestBefore,
        {
          version: 1,
          id: first.id,
          title: first.title,
          phase: 'assembling',
          role: 'host',
          href: `/rooms/${first.id}`,
        },
      ],
    });
  });
});

test('of two simultaneous creates or joins by one user exactly one wins', async () => {
  await withRoomRuntime(async (f) => {
    const creates = await Promise.allSettled([f.create(), f.create()]);
    const [a, b] = await Promise.all([
      f.create({}, f.guest),
      f.create({}, f.outsider),
    ]);
    const member = await f.member();
    const joins = await Promise.allSettled(
      [a!.view, b!.view].map((view) =>
        f.command(member, view, {
          type: 'claim-seat',
          role: 'negative',
          slot: 0,
        }),
      ),
    );
    const held = await memberships(f, [member.actorId]);
    assert({
      given: 'one host creating twice and one member joining two Rooms at once',
      should:
        'accept exactly one of each, refuse the other as active-room, and hold one membership',
      actual: [
        creates.map(refusal).sort(),
        joins.map(refusal).sort(),
        (
          await f.sql`select count(*)::int n from rooms where host_actor_id=${f.host.actorId}`
        )[0].n,
        held.length,
      ],
      expected: [
        ['accepted', 'active-room'],
        ['accepted', 'active-room'],
        1,
        1,
      ],
    });
  });
});

test('closing, a host leaving and a guest leaving free exactly their members', async () => {
  await withRoomRuntime(async (f) => {
    let room = (await f.create()).view;
    for (const [who, role] of [
      [f.host, 'affirmative'],
      [f.guest, 'negative'],
    ] as const)
      room = (await f.command(who, room, { type: 'claim-seat', role, slot: 0 }))
        .view;
    room = (await f.command(f.guest, room, { type: 'leave-seat' })).view;
    const afterGuest = await memberships(f, [f.host.actorId, f.guest.actorId]);
    room = (await f.command(f.host, room, { type: 'leave-seat' })).view;
    const afterHost = await memberships(f, [f.host.actorId]);
    const reopened = (await f.create()).view;
    const closed = (await f.command(f.host, reopened, { type: 'close' })).view;
    assert({
      given:
        'a guest leaving, the seated host leaving, then the host closing a new Room',
      should:
        'free the guest alone, close the Room on host leave, and free the host on close',
      actual: [
        afterGuest,
        room.status,
        afterHost,
        closed.status,
        await memberships(f, [f.host.actorId]),
        await f.operations.activeRoom(f.host),
      ],
      expected: [
        [[f.host.actorId, room.id]],
        'abandoned',
        [],
        'abandoned',
        [],
        null,
      ],
    });
  });
});

test('maintenance closes a Room idle past the timeout and frees its members', async () => {
  await withRoomRuntime(async (f) => {
    const idle = (await f.create()).view;
    const busy = (await f.create({}, f.guest)).view;
    await f.sql`update rooms set updated_at = statement_timestamp() - interval '11 minutes' where id=${idle.id}`;
    const candidates = await f.store.readIdleRoomCandidates({
      idleTimeoutMs: 600_000,
      limit: 64,
    });
    const expire = (roomId: string) =>
      f.store.expireIdleRoom({
        roomId,
        expire: (state, facts) =>
          expireIdleRoom(state, { ...facts, idleTimeoutMs: 600_000 }),
      });
    const expired = [await expire(idle.id), await expire(busy.id)];
    const outbox = await f.sql`
      select count(*)::int n from outbox where topic=${`room:${idle.id}`}`;
    assert({
      given: 'one Room idle eleven minutes and one just created',
      should:
        'find and close only the idle one, announce it, and free its host',
      actual: [
        candidates.includes(idle.id),
        candidates.includes(busy.id),
        expired,
        (await f.operations.view(f.host, idle.id)).status,
        outbox[0].n,
        await memberships(f, [f.host.actorId, f.guest.actorId]),
      ],
      expected: [
        true,
        false,
        [true, false],
        'abandoned',
        2,
        [[f.guest.actorId, busy.id]],
      ],
    });
  });
});

test('a live Round holds its members until it ends; the end frees them for a rematch', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const { roundId, operations } = await startRuntimeRound(f, room);
    const live = await f.operations.activeRoom(f.guest);
    await assertRejects({
      given: 'a debater in a live Round',
      should: 'refuse a new Room',
      actual: () => f.create({}, f.guest),
      code: 'CONFLICT',
    });
    const active = (await f.store.getRound(roundId))!;
    await operations.command(
      { kind: 'human', actorId: f.guest.actorId },
      roundId,
      {
        version: 1,
        commandId: createId(),
        expectedVersion: active.version,
        command: {
          type: 'forfeit',
          participantId: active.participants.find(
            (p) => p.actorId === f.guest.actorId,
          )!.id,
        },
      },
    );
    const freed = await memberships(f, [f.host.actorId, f.guest.actorId]);
    const selection = (await f.operations.catalog(f.host)).find(
      (c) => c.formatId === 'foundation',
    )!;
    const rematch = await f.operations.rematch(f.host, room.id, {
      commandId: createId(),
      title: 'Rematch',
      topic: 'Libraries should remain public',
      visibility: 'public',
      selection: {
        kind: 'catalog',
        formatId: selection.formatId,
        formatVersion: selection.formatVersion,
        config: selection.defaultConfig,
        length: 'full',
        competitionType: 'casual',
      },
    });
    try {
      assert({
        given:
          'a launched Round, then its debater forfeiting it, then a rematch',
        should:
          'read the Round as the live active room, free both members on forfeit, and admit the rematch',
        actual: [live, freed, await memberships(f, [f.host.actorId])],
        expected: [
          {
            version: 1,
            id: room.id,
            title: room.title,
            phase: 'live',
            role: 'debater',
            href: `/rounds/${roundId}/room`,
          },
          [],
          [[f.host.actorId, rematch.view.id]],
        ],
      });
    } finally {
      await f.sql`delete from rooms where id=${rematch.view.id}`;
    }
  });
});

test('the database itself refuses a second active membership for one actor', async () => {
  await withRoomRuntime(async (f) => {
    const first = (await f.create()).view;
    const second = (await f.create({}, f.guest)).view;
    const attempt = await f.sql`
      insert into room_active_memberships (actor_id, room_id)
      values (${f.host.actorId}, ${second.id})`.then(
      () => 'accepted',
      (error: { errno?: string }) => error.errno ?? 'unexpected',
    );
    assert({
      given: 'a raw insert naming a host another Room already holds',
      should:
        'refuse it with a unique violation and keep the host in their Room',
      actual: [attempt, await memberships(f, [f.host.actorId])],
      expected: ['23505', [[f.host.actorId, first.id]]],
    });
  });
});
