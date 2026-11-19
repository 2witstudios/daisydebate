import { requireTestServices } from '@daisy/config';
import { maintainRoom } from '@daisy/debate-engine';
import { isAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { deleteOrphanNotificationSignals } from './notification-signals.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const memberships = async (f: Fixture, actorIds: readonly string[]) =>
  (
    await f.sql<{ actor_id: string; room_id: string }[]>`
      select actor_id, room_id from active_seats
      where actor_id in ${f.sql(actorIds)} order by actor_id`
  ).map((row) => [row.actor_id, row.room_id]);
const refusal = (outcome: PromiseSettledResult<unknown>) =>
  outcome.status === 'fulfilled'
    ? 'accepted'
    : isAppError(outcome.reason)
      ? outcome.reason.reason
      : 'unexpected';
/** A create that seats its own host: a seat is what holds a person (TAB-6). */
const seatedCreate = (f: Fixture, who: Fixture['host'] = f.host) =>
  f.create(
    {
      cast: [
        {
          actorId: who.actorId,
          seat: { kind: 'side', side: 'affirmative', slot: 0 },
        },
      ],
    },
    who,
  );
/** A Room whose host then claims a seat: held by that seat. */
const heldRoom = async (f: Fixture, who: Fixture['host'] = f.host) => {
  const { view } = await f.create({}, who);
  return (
    await f.command(who, view, {
      type: 'claim-seat',
      seat: { kind: 'side', side: 'affirmative', slot: 0 },
    })
  ).view;
};

test('a second create or join is refused while another Room holds the user, leaving every state unchanged', async () => {
  await withRoomRuntime(async (f) => {
    const first = await heldRoom(f);
    const before = await f.snapshot(first.id);
    await assertRejects({
      given: 'a host whose seat in an assembling Room holds them',
      should: 'refuse a second create that seats them',
      actual: () => seatedCreate(f),
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
          seat: { kind: 'side', side: 'affirmative', slot: 0 },
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
          seated: true,
          href: `/rooms/${first.id}`,
        },
      ],
    });
  });
});

test('a Train practice holds its seatless creator through their own commands; a standing Room does not (decision 75, TAB-6.16)', async () => {
  await withRoomRuntime(async (f) => {
    const practice = (await f.create({ practice: true })).view;
    await f.command(f.host, practice, {
      type: 'set-visibility',
      visibility: 'unlisted',
    });
    const heldAfterCommand = (await f.operations.activeRoom(f.host))?.id;
    await assertRejects({
      given: 'a practice creator who changed their Room before taking a seat',
      should: 'refuse a second practice: the first still holds them',
      actual: () => f.create({ practice: true }),
      code: 'CONFLICT',
    });
    const standing = (await f.create({}, f.guest)).view;
    await f.command(f.guest, standing, {
      type: 'set-visibility',
      visibility: 'unlisted',
    });
    assert({
      given:
        'a practice creator after their own command, and a seatless standing host after theirs',
      should:
        'hold the practice creator in their Room, and hold the standing host nowhere',
      actual: [heldAfterCommand, await f.operations.activeRoom(f.guest)],
      expected: [practice.id, null],
    });
  });
});

test('of two simultaneous creates or joins by one user exactly one wins', async () => {
  await withRoomRuntime(async (f) => {
    const creates = await Promise.allSettled([
      seatedCreate(f),
      seatedCreate(f),
    ]);
    const [a, b] = await Promise.all([
      f.create({}, f.guest),
      f.create({}, f.outsider),
    ]);
    const member = await f.member();
    const joins = await Promise.allSettled(
      [a!.view, b!.view].map((view) =>
        f.command(member, view, {
          type: 'claim-seat',
          seat: { kind: 'side', side: 'negative', slot: 0 },
        }),
      ),
    );
    const held = await memberships(f, [member.actorId]);
    assert({
      given:
        'one host creating twice, seated each time, and one member joining two Rooms at once',
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

test('a guest leaving frees only them, a host leaving their seat is free, and Close frees everyone', async () => {
  await withRoomRuntime(async (f) => {
    let room = (await f.create()).view;
    for (const [who, side] of [
      [f.host, 'affirmative'],
      [f.guest, 'negative'],
    ] as const)
      room = (
        await f.command(who, room, {
          type: 'claim-seat',
          seat: { kind: 'side', side, slot: 0 },
        })
      ).view;
    room = (await f.command(f.guest, room, { type: 'leave-seat' })).view;
    const afterGuest = await memberships(f, [f.host.actorId, f.guest.actorId]);
    room = (await f.command(f.host, room, { type: 'leave-seat' })).view;
    const seatless = await f.operations.activeRoom(f.host);
    const seatlessHeld = await memberships(f, [f.host.actorId]);
    const closed = (await f.command(f.host, room, { type: 'close' })).view;
    assert({
      given:
        'a guest leaving, the seated host leaving their seat, then the host closing',
      should:
        'free the guest alone, free the seatless host while the Room stays open (TAB-6: a seat is what holds a person), and hold no one after Close',
      actual: [
        afterGuest,
        room.status,
        seatless,
        seatlessHeld,
        closed.status,
        await memberships(f, [f.host.actorId]),
        await f.operations.activeRoom(f.host),
      ],
      expected: [
        [[f.host.actorId, room.id]],
        'assembling',
        null,
        [],
        'closed',
        [],
        null,
      ],
    });
  });
});

test('maintenance closes a Room idle past the timeout and frees its members', async () => {
  await withRoomRuntime(async (f) => {
    const idle = await heldRoom(f);
    const busy = await heldRoom(f, f.guest);
    await f.sql`update rooms set last_command_at = statement_timestamp() - interval '11 minutes' where id=${idle.id}`;
    const candidates = await f.store.readMaintenanceCandidates({
      idleTimeoutMs: 600_000,
      limit: 64,
    });
    const expire = (roomId: string) =>
      f.store.maintainRoom({
        roomId,
        maintain: (state, facts) =>
          maintainRoom(state, {
            ...facts,
            idleTimeoutMs: 600_000,
          }),
      });
    const expired = [await expire(idle.id), await expire(busy.id)];
    const outbox = await f.sql`
      select count(*)::int n from outbox where topic=${`room:${idle.id}`}`;
    assert({
      given: 'one Room idle eleven minutes and one just created',
      should:
        "find and close only the idle one, announce it (after its create and its host's seat claim), and free its host",
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
        'closed',
        3,
        [[f.guest.actorId, busy.id]],
      ],
    });
  });
});

test('a live Round holds its members until it ends; the end frees them for a rematch', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const { roundId, operations } = await launchRuntimeRound(f, room);
    const live = await f.operations.activeRoom(f.guest);
    await assertRejects({
      given: 'a debater in a live Round',
      should: 'refuse a new Room that seats them',
      actual: () => seatedCreate(f, f.guest),
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
    const rematch = await f.operations.rematch(f.host, room.id, {
      commandId: createId(),
      title: 'Rematch',
      resolution: { kind: 'custom', text: 'Libraries should remain public' },
      visibility: 'public',
      selection: f.foundationSelection,
    });
    try {
      assert({
        given:
          'a launched Round, then its debater forfeiting it, then a rematch',
        should:
          'read the Round as the live active room, free both members on forfeit, and admit the rematch, which holds its seatless host not at all (TAB-6)',
        actual: [live, freed, await memberships(f, [f.host.actorId])],
        expected: [
          {
            version: 1,
            id: room.id,
            title: room.title,
            phase: 'live',
            role: 'side',
            seated: true,
            href: `/rounds/${roundId}/room`,
          },
          [],
          [],
        ],
      });
    } finally {
      // The fixture does not track a rematch's Room: remove it and its doorbell.
      await f.sql`delete from outbox where topic=${`room:${rematch.view.id}`}`;
      await f.sql`delete from rooms where id=${rematch.view.id}`;
      await deleteOrphanNotificationSignals(f.sql);
    }
  });
});

test('the database itself refuses a second active membership for one actor', async () => {
  await withRoomRuntime(async (f) => {
    const first = await heldRoom(f);
    const second = await heldRoom(f, f.guest);
    const attempt = await f.sql`
      insert into active_seats (actor_id, room_id)
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
