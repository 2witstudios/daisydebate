import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { hostRoundViewSchema } from '@daisy/protocol/lobby/draw-read';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { drawFormEnvelope } from '../src/features/tab/draw-form';
import { readHostRound } from '../src/features/tab/reads/host-round';
import { origin } from '../src/features/auth/member-boundary.test-support';
import {
  acceptedDrawResponse,
  drawHttp,
} from './tab-tournament-draw-draft.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import {
  tabLobbyCommand,
  tabRead,
} from './tab-tournament-transport.test-support';
import type { World } from './tab-tournament.test-support';

export const publishDrawStage = async (
  world: World,
  beforePublish?: (attempt: () => Promise<unknown>) => Promise<void>,
): Promise<void> => {
  const { database, sql } = world;
  const lobbyId = world.made.get('tournament-lobby')!,
    drawId = world.made.get('draw')!;
  const store = createTabStore(database);
  const send = tabLobbyCommand(world, 'draw');
  const [slot] =
    await sql`select version from time_slots where id=${world.made.get('time-slot')!}`;
  const [event] =
    await sql`select entries_version from events where id=${world.made.get('event')!}`;
  const target = {
    version: 1,
    commandId: createId(),
    expected: {
      draw: 1,
      entries: Number(event!.entries_version),
      timeSlot: Number(slot!.version),
    },
    command: { type: 'publish-draw', drawId, overrides: [] },
  };
  const envelope = drawFormEnvelope(
    {
      handle: 'tournament',
      lobbyId,
      eventId: world.made.get('event')!,
      tabRoundId: world.made.get('tab-round')!,
      overrideKeys: [],
      envelope: {
        ...target,
        version: 1,
        command: { ...target.command, type: 'publish-draw' },
      },
    },
    new FormData(),
  );
  const nonHostDenied = await deniedAsNotFound(() =>
    send(as(world.bots.Coach!), lobbyId, envelope),
  );
  const publicationRequest = () =>
    new Request(
      `${origin}/api/tab/draw-command?${new URLSearchParams({ lobbyId })}`,
      {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
  const submit = () =>
    world.http
      ? world.http(
          world.bots.Director!,
          `/api/tab/draw-command?${new URLSearchParams({ lobbyId })}`,
          envelope,
        )
      : drawHttp(world)(publicationRequest());
  await beforePublish?.(() =>
    send(as(world.bots.Director!), lobbyId, envelope),
  );
  const answer = await acceptedDrawResponse(await submit());
  assert({
    given:
      'the actual computed first draft with matching pinned one-judge panels',
    should: 'publish through the command transaction',
    actual: answer.kind,
    expected: 'accepted',
  });
  assert({
    given: 'the actual host-only draw publication command',
    should: 'refuse a non-host before any Room is assembled',
    actual: nonHostDenied,
    expected: true,
  });
  const replay = await acceptedDrawResponse(await submit());
  const rooms = await sql<
    {
      host_actor_id: string | null;
      lobby_id: string;
      lobby_kind: string;
      topic: string | null;
      format_id: string;
      format_version: number;
      capture: { recordingPolicy: string } | null;
      id: string;
      fixture_id: string;
    }[]
  >`select r.id,r.host_actor_id,r.lobby_id,r.lobby_kind,r.topic,r.format_id,r.format_version,r.capture,f.id fixture_id from rooms r join fixtures f on f.room_id=r.id where f.tab_round_id=${world.made.get('tab-round')!} order by r.id`;
  const publishedRead = await tabRead(
    world,
    'host-round',
    hostRoundViewSchema,
    readHostRound({ store, authorize }),
    (input) => ({ ...input }),
  )(as(world.bots.Director!), {
    lobbyId,
    eventId: world.made.get('event')!,
    tabRoundId: world.made.get('tab-round')!,
  });
  assert({
    given: 'the genuine published Rooms before native Ready or Start',
    should:
      'show their actual Room links and waiting state without inventing a started timestamp or speech',
    actual: [
      publishedRead?.kind,
      publishedRead?.kind === 'published'
        ? publishedRead.round.startedAt
        : 'not-published',
      publishedRead?.kind === 'published'
        ? publishedRead.round.open
            .map((fixture) => [fixture.state.kind, fixture.room?.roomId])
            .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
        : null,
    ],
    expected: [
      'published',
      null,
      rooms.map((room) => ['waiting_for_start', room.id]),
    ],
  });
  const seats = await sql<
    { readiness_command_id: string | null }[]
  >`select p.actor_id,p.readiness_command_id,a.room_id from room_participants p join active_seats a on a.actor_id=p.actor_id and a.room_id=p.room_id where p.room_id in (select room_id from fixtures where tab_round_id=${world.made.get('tab-round')!})`;
  assert({
    given:
      'published event Rooms reloaded with their actual fixture provenance and seated people',
    should:
      'remain in the tournament, pin actual wording/format/recording off, preserve no-host identity and avoid invented Ready',
    actual: [
      rooms.length,
      rooms.every(
        (row) =>
          row.host_actor_id === null &&
          row.lobby_id === lobbyId &&
          row.lobby_kind === 'tournament' &&
          row.topic === 'Public libraries should receive more funding.' &&
          row.format_id === 'freestyle' &&
          Number(row.format_version) === 1 &&
          row.capture?.recordingPolicy === 'off',
      ),
      seats.length,
      seats.every((row) => row.readiness_command_id === null),
      replay.kind === 'accepted' ? replay.receipt.replayed : false,
    ],
    expected: [2, true, 6, true, true],
  });
  const sides = await sql<
    { team_one_side: string | null; open: number }[]
  >`select r.team_one_side, (select count(*)::int from room_participants p where p.room_id = r.id and (p.team_open or p.position_open)) open from rooms r join fixtures f on f.room_id=r.id where f.tab_round_id=${world.made.get('tab-round')!} order by r.id`;
  assert({
    given: 'the published event Rooms (ADR 0145)',
    should:
      'seat each team on the side the draw gave it, with no coin flip and no ? seat',
    actual: sides,
    expected: rooms.map(() => ({ team_one_side: 'affirmative', open: 0 })),
  });
  if (rooms[0]) {
    world.made.set('first-room', rooms[0].id);
    world.made.set('first-fixture', rooms[0].fixture_id);
  }
};
