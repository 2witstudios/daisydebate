import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { settingCommand } from '../src/features/tab/operations/settings';
import { createLobbyRoom } from '../src/features/tab/operations/create-lobby-room';
import { readStandingRoomDraft } from '../src/features/tab/reads/standing-room-draft';
import { readLeagueSeason } from '../src/features/tab/reads/league-season';
import { judgeSeat, sideSeat } from '@daisy/protocol';
import { withRoomRuntime } from './room-runtime.test-support';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import { readLadder } from '../src/features/leaderboard/read-leaderboard';
import { readRatingStandings } from '../src/features/ratings/read';
import { rateCompletedRound } from '../src/features/ratings/rate-debate';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

export async function selectedLobbyCases(world: World) {
  const store = createTabStore(world.database);
  const dependencies = {
    store,
    authorize,
    newId: createId,
    now: world.clock.now,
  };
  const principal = as(world.bots.Director!);
  const organizationId = world.made.get('league')!;
  const templateId = world.made.get('league-template')!;
  const administer = lobbyAdministrationCommand(dependencies);
  const siblings: string[] = [];
  for (const name of ['Sibling A', 'Sibling B']) {
    const answer = await administer(principal, {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-lobby',
        owner: { kind: 'organization', organizationId },
        name,
        handle: `selected-${createId()}`,
        lobby: { kind: 'standing' },
      },
    });
    if (answer.kind !== 'accepted') throw new Error(JSON.stringify(answer));
    const lobbyId = answer.receipt.aggregate.id;
    siblings.push(lobbyId);
    const season = await administer(principal, {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-season',
        organizationId,
        lobbyId,
        name: `${name} season`,
        startsAt: world.clock.now(),
        endsAt: null,
        counting: 'sanction',
        countsLobbyRooms: true,
        rule: {},
      },
    });
    if (season.kind !== 'accepted') throw new Error(JSON.stringify(season));
  }
  const [otherLobbyId, lobbyId] = siblings.sort() as [string, string];
  const settings = settingCommand(dependencies);
  const otherLadder = createId();
  const primaryLadder = createId();
  const selectedLadder = createId();
  await world.sql`insert into ladders(id,lobby_id,organization_id,name,created_at)
    values (${otherLadder},${otherLobbyId},${organizationId},'Other lobby',now()-interval '2 days'),
      (${primaryLadder},${lobbyId},${organizationId},'Primary ladder',now()-interval '1 day'),
      (${selectedLadder},${lobbyId},${organizationId},'Selected ladder',now())`;
  const createInLobby = async (roomLobbyId: string, ladderId: string) => {
    const offered = await settings(principal, {
      version: 1,
      commandId: createId(),
      expected: { lobby: 1 },
      command: { type: 'offer-template', lobbyId: roomLobbyId, templateId },
    });
    if (offered.kind !== 'accepted') throw new Error(JSON.stringify(offered));
    const [lobby] =
      await world.sql`select settings_version from lobbies where id=${roomLobbyId}`;
    const selected = await settings(principal, {
      version: 1,
      commandId: createId(),
      expected: { settings: Number(lobby!.settings_version) },
      command: {
        type: 'set-setting',
        scope: { kind: 'lobby', id: roomLobbyId },
        key: 'standings.rating_ladder',
        hold: 'default',
        value: { ladderId },
      },
    });
    if (selected.kind !== 'accepted') throw new Error(JSON.stringify(selected));
    const draft = await readStandingRoomDraft(dependencies)(principal, {
      lobbyId: roomLobbyId,
      templateId,
    });
    if (!draft?.creation) throw new Error('Missing sibling creation read');
    assert({
      given: 'the native Room draft for a configured ladder',
      should:
        'identify exactly the selected ladder, even when an older one exists',
      actual: draft.creation.rating,
      expected: { kind: 'rated', ladderId },
    });
    const commandId = createId();
    const created = await createLobbyRoom(dependencies)(principal, {
      version: 1,
      commandId,
      expected: {},
      command: {
        type: 'create-lobby-room',
        lobbyId: roomLobbyId,
        templateId,
        config: draft.creation.config,
        room: {
          commandId,
          title: 'Selected sibling Room',
          visibility: draft.creation.visibility.value,
          selection: draft.creation.selection,
          resolution: {
            kind: 'custom',
            text: 'Resolved: this is the selected sibling.',
          },
        },
      },
    });
    if (created.kind !== 'accepted') throw new Error(JSON.stringify(created));
    return created;
  };
  const created = await createInLobby(lobbyId, selectedLadder);
  const [first] = await world.sql`select l.id from lobbies l
      where l.owner_organization_id=${organizationId} and l.kind='standing'
        and exists(select 1 from seasons s where s.lobby_id=l.id)
      order by l.id limit 1`;
  const facts = await store.leagueSeason(
    { viewerUserId: principal.userId, organizationId, lobbyId },
    async (value) => value,
  );
  assert({
    given:
      'two sibling standing lobbies and a Room in an explicitly selected nonfirst sibling',
    should: 'select its actual identity and only its Rooms',
    actual: [
      lobbyId !== first!.id,
      facts?.standingLobby?.id,
      facts?.standingRooms.map((room) => [room.id, room.lobbyId]),
    ],
    expected: [true, lobbyId, [[created.receipt.aggregate.id, lobbyId]]],
  });
  await world.sql`update rooms set visibility='private' where id=${created.receipt.aggregate.id}`;
  const listedTo = async (who: ReturnType<typeof as>) =>
    store.leagueSeason(
      { viewerUserId: who.userId, organizationId, lobbyId },
      async (value) => value?.standingRooms.map((room) => room.id),
    );
  assert({
    given: 'a private Room in the members-only lobby',
    should: 'list it to its host and never to another member',
    actual: [await listedTo(principal), await listedTo(as(world.bots.Coach!))],
    expected: [[created.receipt.aggregate.id], []],
  });
  await world.sql`update rooms set visibility='unlisted' where id=${created.receipt.aggregate.id}`;
  assert({
    given: 'an unlisted Room in the lobby',
    should: 'list it to its host and never to another member',
    actual: [await listedTo(principal), await listedTo(as(world.bots.Coach!))],
    expected: [[created.receipt.aggregate.id], []],
  });
  await world.sql`update rooms set visibility='public' where id=${created.receipt.aggregate.id}`;
  assert({
    given: 'a public Room in the lobby',
    should: 'list it to another member',
    actual: await listedTo(as(world.bots.Coach!)),
    expected: [created.receipt.aggregate.id],
  });
  await world.sql`update rooms set visibility='unlisted' where id=${created.receipt.aggregate.id}`;
  const read = readLeagueSeason(dependencies);
  const selected = await read(principal, {
    organizationId,
    lobbyId,
    templateId,
  });
  assert({
    given: 'the selected sibling passed through the application read',
    should: 'retain its identity and Room title in the projection',
    actual: [
      selected?.standingLobby?.id,
      JSON.stringify(selected?.rooms).includes('Selected sibling Room'),
    ],
    expected: [lobbyId, true],
  });
  const [foreign] =
    await world.sql`select id from lobbies where owner_organization_id <> ${organizationId} and kind='standing' order by id limit 1`;
  if (!foreign) throw new Error('Missing actual foreign standing lobby');
  for (const invalidId of [
    createId(),
    world.made.get('tournament-lobby')!,
    String(foreign.id),
  ]) {
    assert({
      given: 'a missing, nonstanding or foreign requested lobby',
      should: 'return null without falling back to an organization sibling',
      actual: await read(principal, {
        organizationId,
        lobbyId: invalidId,
        templateId,
      }),
      expected: null,
    });
  }
  const host = await store.leagueSeason(
    { viewerUserId: principal.userId, organizationId },
    async (value) => value?.standingLobby?.id,
  );
  assert({
    given: 'an organization-only host read',
    should: 'select the first standing lobby with an owned season',
    actual: host,
    expected: first!.id,
  });
  if (!world.runtimeDatabaseUrl)
    throw new Error('Missing Room runtime database');
  const other = await createInLobby(otherLobbyId, otherLadder);
  const [owner] =
    await world.sql`select official from organizations where id=${organizationId}`;
  await world.sql`update organizations set official=true where id=${organizationId}`;
  try {
    const debater = world.bots['Debater 1']!;
    const project = (
      lobby: string,
      ladder: string,
      rating: number,
    ) => world.sql`
      insert into ratings(actor_id,lobby_id,ladder,season_id,rating,deviation,volatility)
      select ${debater.actorId},${lobby},${ladder},id,${rating},60,0.06
      from seasons where lobby_id=${lobby} and status='active'`;
    await project(otherLobbyId, otherLadder, 1788);
    await project(lobbyId, primaryLadder, 1666);
    await withRoomRuntime(
      async (f) => {
        const seat = async (id: string) => {
          const view = await f.operations.view(debater, id);
          await f.command(debater, view, {
            type: 'claim-seat',
            seat: sideSeat('affirmative'),
          });
        };
        const rating = async (id: string) => {
          const view = await f.operations.view(debater, id);
          const person = view.participants.find(
            (p) => !('anonymous' in p) && p.actorId === debater.actorId,
          );
          return person && !('anonymous' in person)
            ? (person.rating?.value ?? null)
            : null;
        };
        const otherId = other.receipt.aggregate.id;
        const selectedId = created.receipt.aggregate.id;
        await seat(otherId);
        const fromOther = await rating(otherId);
        await f.command(debater, await f.operations.view(debater, otherId), {
          type: 'leave-seat',
        });
        await seat(selectedId);
        const before = await rating(selectedId);
        await project(lobbyId, selectedLadder, 1555);
        assert({
          given:
            'actual Room views in two adult lobbies, with the second Room pinned to its secondary ladder',
          should:
            'wait for a rating on that exact ladder without borrowing either available alternative',
          actual: [fromOther, before, await rating(selectedId)],
          expected: [1788, null, 1555],
        });
        await world.sql`update rooms set visibility='public' where id=${selectedId}`;
        const opposition = world.bots['Debater 2']!;
        const judge = world.bots['Judge A']!;
        await f.command(
          opposition,
          await f.operations.view(opposition, selectedId),
          {
            type: 'claim-seat',
            seat: sideSeat('negative'),
          },
        );
        await f.command(judge, await f.operations.view(judge, selectedId), {
          type: 'claim-seat',
          seat: judgeSeat(),
        });
        for (const person of [debater, opposition, judge])
          await f.consent(
            person,
            await f.operations.view(person, selectedId),
            'ready',
          );
        const director = world.bots.Director!;
        const started = await f.command(
          director,
          await f.operations.view(director, selectedId),
          { type: 'start-round' },
        );
        const round = (await f.store.getRound(started.view.roundRef!.id))!;
        const seatOfDebater = round.participants.find(
          (p) => p.actorId === debater.actorId,
        )!;
        await createRoundRuntimeOperations({
          store: f.store,
          nextSegmentId: createId,
        }).command({ kind: 'human', actorId: debater.actorId }, round.id, {
          version: 1,
          commandId: createId(),
          expectedVersion: round.version,
          command: { type: 'forfeit', participantId: seatOfDebater.id },
        });
        const posted = await rateCompletedRound(f.store, round.id, {
          next: createId,
        });
        const league = readLeagueLadder({ store, authorize });
        const gamesFor = async (name: 'Director' | 'Coach') => {
          const read = await league(as(world.bots[name]!), { lobbyId });
          const line = read?.lines.find(
            (row) => row.actorId === debater.actorId,
          );
          return line ? line.wins + line.losses : null;
        };
        assert({
          given: 'a real public game played on the newer configured ladder',
          should:
            'show that game to the receiving host and member through the same league read',
          actual: [
            posted.kind === 'rated' && posted.scope.ladderId,
            await gamesFor('Director'),
            await gamesFor('Coach'),
          ],
          expected: [selectedLadder, 1, 1],
        });
        if (posted.kind !== 'rated')
          throw new Error(`Expected a posting: ${posted.kind}`);
        const postedRating = posted.changes.find(
          (change) => change.actorId === debater.actorId,
        )!.after.rating;
        const clock = {
          seasonId: null,
          ladder: { style: 'freestyle', division: 'open' } as const,
          now: new Date().toISOString(),
        };
        const [board, older] = await Promise.all([
          readLadder(f.store, { ...clock, lobbyId, username: null }),
          readRatingStandings(f.store, {
            ...clock,
            frozenLadder: { lobbyId, ladderId: primaryLadder },
          }),
        ]);
        const published = board?.data.entries.find(
          (row) => row.id === debater.actorId,
        );
        const control = older?.entriesBySeason[older.season.id]?.find(
          (row) => row.id === debater.actorId,
        );
        assert({
          given:
            'a signed-out leaderboard request for this official lobby with two ladders',
          should:
            'publish the configured ladder’s released game and keep 1666 on the older ladder',
          actual: [
            board?.viewer,
            published?.played,
            published?.rating,
            control?.played,
            control?.rating,
          ],
          expected: [null, 1, postedRating, 0, 1666],
        });
      },
      { databaseUrl: world.runtimeDatabaseUrl },
    );
  } finally {
    await world.sql`update organizations set official=${owner!.official} where id=${organizationId}`;
  }
}
