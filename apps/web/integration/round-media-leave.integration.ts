import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { catalogFormats } from '@daisy/db/catalog-formats';
import { assertRejects } from '@daisy/errors/testing';
import type { RoomView } from '@daisy/protocol/room-contract';
import { Room } from '@livekit/rtc-node';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import {
  admissionRevoked,
  mediaRuntime,
} from '../src/features/round-media/projection';
import { everyoneReady } from './round-judging.test-support';
import { mediaDependencies } from './round-media.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * TAB-6.8 through the real media path: a person who leaves a Round no
 * forfeit ends is withdrawn from its media in place. The room the remaining
 * seats are in is never rotated or deleted for it; only the leaver's own
 * grants are taken, and the leaver is refused before anything is bound for it.
 */
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Caller = Fixture['host'];

const openConversation = catalogFormats.find(
  (format) => format.id === 'open-conversation',
)!;

/** The open conversation for three speakers, launched with all three seated and its open segment running. */
async function runningConversation(f: Fixture, people: readonly Caller[]) {
  let room: RoomView = (
    await f.create({
      selection: {
        kind: 'custom',
        definition: {
          ...openConversation.definition,
          seats: {
            ...openConversation.definition.seats,
            speakers: people.length,
          },
        },
        config: openConversation.preset,
        competitionType: 'casual',
      },
    })
  ).view;
  for (const [slot, who] of people.entries())
    room = (
      await f.command(who, room, {
        type: 'claim-seat',
        seat: { kind: 'speaker', slot },
      })
    ).view;
  room = await everyoneReady(f, room, people);
  const { roundId, operations } = await launchRuntimeRound(f, room);
  const launched = (await f.store.getRound(roundId))!;
  // Into the open segment: past the countdown, well before its end.
  await f.sql`update rounds set started_at=clock_timestamp()-${launched.rules.countdownMs + 5_000}*interval '1 millisecond' where id=${roundId}`;
  await f.store.executeRoundTick({
    roundId,
    buildProjection: roundTickProjection(createId),
  });
  return { roundId, operations };
}

/** `who` leaves through the real round command. */
async function leave(
  f: Fixture,
  operations: Awaited<ReturnType<typeof runningConversation>>['operations'],
  roundId: string,
  who: Caller,
) {
  const round = (await f.store.getRound(roundId))!;
  const seat = round.participants.find((p) => p.actorId === who.actorId)!;
  await operations.command({ kind: 'human', actorId: who.actorId }, roundId, {
    version: 1,
    commandId: createId(),
    expectedVersion: round.version,
    command: { type: 'leave', participantId: seat.id },
  });
  return seat.id;
}

const connect = async (token: string) => {
  const room = new Room();
  await room.connect('ws://127.0.0.1:7880', token, {
    autoSubscribe: false,
    dynacast: false,
  });
  return room;
};

const sessionRow = async (f: Fixture, roundId: string) => {
  const [row] = await f.sql<
    { room_name: string; rotations: number }[]
  >`select s.room_name, (select count(*)::int from media_room_rotations r where r.round_id=s.round_id) as rotations
    from media_sessions s where s.round_id=${roundId}`;
  return row!;
};

const bindingRows = (f: Fixture, roundId: string) =>
  f.sql<
    { seat: string; identity: string }[]
  >`select round_participant_id as seat, identity
    from media_participants where round_id=${roundId} order by round_participant_id`.then(
    (rows) => rows.map((row) => ({ seat: row.seat, identity: row.identity })),
  );

/** Each connected identity's publish grants as the vendor holds them. */
const publishGrants = async (
  deps: ReturnType<typeof mediaDependencies>,
  roomName: string,
) =>
  Object.fromEntries(
    (await deps.media.publicationPermissions(roomName)).map((entry) => [
      entry.identity,
      [...entry.grants.publish].sort(),
    ]),
  );

const snapshotOf = async (f: Fixture, roundId: string) =>
  (await f.store.mediaSessions.readMediaSession({
    roundId,
    admits: admitsPrincipalAccess,
    buildProjection: (context) =>
      mediaRuntime(context, createId).tick(context.now),
  }))!;

test('a person leaving an open conversation is withdrawn from its media in place, never rotating the room (TAB-6.8)', async () => {
  await withRoomRuntime(async (f) => {
    const people = [f.host, f.guest, f.outsider];
    const { roundId, operations } = await runningConversation(f, people);
    const deps = mediaDependencies(f);
    const media = createRoundMediaOperations(deps);
    const connected: Room[] = [];
    try {
      const admitted = [];
      for (const who of people) {
        const admission = await media.session(roundId, who.actorId);
        admitted.push(admission);
        connected.push(await connect(admission.token));
      }
      const [host, leaver, stayer] = admitted as [
        (typeof admitted)[number],
        (typeof admitted)[number],
        (typeof admitted)[number],
      ];
      const before = await sessionRow(f, roundId);
      const bindingsBefore = await bindingRows(f, roundId);
      const grantsBefore = await publishGrants(deps, before.room_name);

      const leftSeat = await leave(f, operations, roundId, f.guest);
      const snapshot = await snapshotOf(f, roundId);
      assert({
        given:
          'three people bound to the open conversation’s media, then one leaving through the round command',
        should:
          'withdraw only the leaver and never read the room as revoked, so it is not rotated',
        actual: {
          revoked: admissionRevoked(snapshot),
          withdrawn: snapshot.withdrawn,
          ineligible: snapshot.participants
            .filter((seat) => !seat.eligible)
            .map((seat) => seat.id),
        },
        expected: { revoked: false, withdrawn: [leftSeat], ineligible: [] },
      });

      await media.reconcile(roundId);
      await media.reconcile(roundId);
      const after = await sessionRow(f, roundId);
      assert({
        given: 'repeated reconciles after the leave, all three still connected',
        should:
          'demote only the leaver’s identity, keep every other seat’s grants, and keep the same room',
        actual: {
          grants: await publishGrants(deps, before.room_name),
          room: after.room_name,
          rotations: after.rotations,
          exists: await deps.media.exists(before.room_name),
        },
        expected: {
          grants: {
            [host.identity]: grantsBefore[host.identity],
            [leaver.identity]: [],
            [stayer.identity]: grantsBefore[stayer.identity],
          },
          room: before.room_name,
          rotations: before.rotations,
          exists: true,
        },
      });
      assert({
        given: 'the seats that stay, before the leave',
        should: 'have held the open microphone, so keeping it is a real proof',
        actual: [host, stayer].map((seat) =>
          grantsBefore[seat.identity]!.includes('microphone'),
        ),
        expected: [true, true],
      });

      await assertRejects({
        given: 'the person who left asking for media again',
        should: 'refuse the admission as unseated',
        code: 'AUTHORIZATION',
        actual: () => media.session(roundId, f.guest.actorId),
      });
      const again = [];
      for (const who of [f.host, f.outsider])
        again.push(await media.session(roundId, who.actorId));
      assert({
        given: 'the refused leaver, then the two seats that stay asking again',
        should:
          'commit no binding, and admit both under their own identities to the same room with their grants',
        actual: {
          bindings: await bindingRows(f, roundId),
          again: again.map((admission) => ({
            identity: admission.identity,
            room: admission.mediaRoomName,
            publish: [...admission.grants.publish].sort(),
          })),
          room: (await sessionRow(f, roundId)).room_name,
        },
        expected: {
          bindings: bindingsBefore,
          again: [host, stayer].map((seat) => ({
            identity: seat.identity,
            room: before.room_name,
            publish: grantsBefore[seat.identity],
          })),
          room: before.room_name,
        },
      });
    } finally {
      for (const room of connected) await room.disconnect();
      const { room_name } = await sessionRow(f, roundId);
      if (await deps.media.exists(room_name))
        await deps.media.deleteRoom(room_name);
    }
  });
}, 60_000);

test('a person who leaves before ever joining the media is refused without a binding (TAB-6.8)', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, operations } = await runningConversation(f, [
      f.host,
      f.guest,
      f.outsider,
    ]);
    const deps = mediaDependencies(f);
    const media = createRoundMediaOperations(deps);
    try {
      await media.session(roundId, f.host.actorId);
      await media.session(roundId, f.outsider.actorId);
      const leftSeat = await leave(f, operations, roundId, f.guest);
      const before = await sessionRow(f, roundId);
      await assertRejects({
        given: 'a seat that left the Round before it ever joined the media',
        should: 'refuse the admission as unseated',
        code: 'AUTHORIZATION',
        actual: () => media.session(roundId, f.guest.actorId),
      });
      const after = await sessionRow(f, roundId);
      assert({
        given: 'that refusal',
        should:
          'commit no media binding for the leaver and leave the room where it was',
        actual: {
          leaverBound: (await bindingRows(f, roundId)).some(
            (row) => row.seat === leftSeat,
          ),
          bindings: (await bindingRows(f, roundId)).length,
          room: after.room_name,
          rotations: after.rotations,
        },
        expected: {
          leaverBound: false,
          bindings: 2,
          room: before.room_name,
          rotations: before.rotations,
        },
      });
    } finally {
      const { room_name } = await sessionRow(f, roundId);
      if (await deps.media.exists(room_name))
        await deps.media.deleteRoom(room_name);
    }
  });
}, 60_000);
