import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import type { TournamentSetupCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import { tournamentRatingSnapshotSchema } from '@daisy/protocol/lobby/rating-snapshot';
import type { SettingCommand } from '@daisy/protocol/lobby/setting-command';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import {
  as,
  StageFailed,
  underFence,
} from './tab-tournament-organization-wiring.test-support';
import {
  tabCommand,
  tabLobbyCommand,
} from './tab-tournament-transport.test-support';
import type { World } from './tab-tournament.test-support';

/** A later tournament draws a real single-elimination bracket from the league's certified games. */
export async function ratingStage(world: World): Promise<void> {
  const store = createTabStore(world.database);
  const director = as(world.bots.Director!);
  const standingLobbyId = world.made.get('standing-lobby')!;
  const [ladder] =
    await world.sql`select id from ladders where lobby_id=${standingLobbyId}`;
  if (!ladder) throw new StageFailed('league ladder missing');
  const ladderId = String(ladder.id);
  const read = readLeagueLadder({ store, authorize });
  const before = await read(director, { lobbyId: standingLobbyId });
  if (!before || before.entrants < 4)
    throw new StageFailed(
      'certified sanctioned tournament did not reach league ladder',
    );
  assert({
    given: 'an outsider knowing the league lobby id and an unknown lobby',
    should: 'hide both ladder reads',
    actual: [
      await read(as(world.bots['Judge A']!), { lobbyId: standingLobbyId }),
      await read(director, { lobbyId: createId() }),
    ],
    expected: [null, null],
  });
  assert({
    given:
      'the active Coach member without a source tournament host grant or public results',
    should: 'read the receiving league ladder with no withheld games',
    actual: (await read(as(world.bots.Coach!), { lobbyId: standingLobbyId }))
      ?.entrants,
    expected: 0,
  });
  const daisyBefore =
    await world.sql`select count(*)::int as count from rating_changes`;
  const created = await tabCommand(world, 'lobbyAdministration')(director, {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-lobby',
      owner: { kind: 'self' },
      name: 'League rated elimination',
      handle: `rated-${createId()}`,
      lobby: {
        kind: 'tournament',
        eligibility: { kind: 'own', ageRule: 'adults' },
      },
    },
  });
  if (created.kind !== 'accepted')
    throw new StageFailed(`rating tournament: ${JSON.stringify(created)}`);
  const lobbyId = created.receipt.aggregate.id;
  world.made.set('rating-tournament-lobby', lobbyId);
  let lobbyVersion = 1;
  const setup = tabCommand(world, 'setup');
  const acceptSetup = async (command: TournamentSetupCommand) => {
    const answer = await setup(director, {
      version: 1,
      commandId: createId(),
      expected: { lobby: lobbyVersion },
      command,
    });
    if (answer.kind !== 'accepted')
      throw new StageFailed(
        `rating setup ${command.type}: ${JSON.stringify(answer)}`,
      );
    lobbyVersion = answer.receipt.resultingVersion;
    return answer.receipt.aggregate.id;
  };
  const prepareRatedEvent = async (name: string) => {
    await acceptSetup({
      type: 'add-event',
      lobbyId,
      name,
      label: null,
      entry: { kind: 'person' },
      pin: { kind: 'template', templateId: world.made.get('league-template')! },
    });
    const [event] =
      await world.sql`select id from events where lobby_id=${lobbyId} and name=${name}`;
    const eventId = String(event!.id);
    await acceptSetup({
      type: 'add-stage',
      lobbyId,
      eventId,
      kind: 'elimination',
      place: 'online',
      timing: { timing: 'live' },
      division: null,
    });
    const [stage] =
      await world.sql`select id from stages where event_id=${eventId}`;
    await acceptSetup({
      type: 'add-tab-round',
      lobbyId,
      stageId: String(stage!.id),
      name: 'Semifinals',
      resolution: null,
    });
    const [round] =
      await world.sql`select id from tab_rounds where event_id=${eventId}`;
    const roundId = String(round!.id);
    let settingsVersion = 1;
    const settings = tabCommand(world, 'settings');
    for (const [key, value] of [
      ['standings.rating_ladder', { ladderId }],
      ['break.seeding', { value: 'rating' }],
      ['break.line', { default: { kind: 'fixed', size: 4 }, byDivision: {} }],
      ['entry.registration', { state: 'open' }],
      ['entry.approval', { value: 'automatic' }],
    ] as const) {
      const answer = await settings(director, {
        version: 1,
        commandId: createId(),
        expected: { settings: settingsVersion },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: eventId },
          key,
          value,
          hold: 'default',
        } as SettingCommand,
      });
      if (answer.kind !== 'accepted')
        throw new StageFailed(
          `rating setting ${key}: ${JSON.stringify(answer)}`,
        );
      settingsVersion += 1;
    }
    const enroll = tabLobbyCommand(world, 'entries');
    let entriesVersion = 1;
    for (const name of ['Debater 1', 'Debater 2', 'Debater 3', 'Debater 4']) {
      const person = world.bots[name]!;
      const answer = await enroll(as(person), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { entries: entriesVersion },
        command: {
          type: 'submit-entry',
          eventId,
          name,
          memberActorIds: [person.actorId],
          responsible: { kind: 'self' },
          division: null,
        },
      });
      if (answer.kind !== 'accepted')
        throw new StageFailed(`rating entry: ${JSON.stringify(answer)}`);
      entriesVersion += 1;
    }
    return { eventId, roundId, settingsVersion, entriesVersion };
  };
  const { eventId, roundId, settingsVersion, entriesVersion } =
    await prepareRatedEvent('Rated singles');
  const parallelEvent = await prepareRatedEvent('Parallel rated singles');
  const generate = tabLobbyCommand(world, 'draw');
  const envelope = {
    version: 1,
    commandId: createId(),
    expected: {
      entries: entriesVersion,
      settings: settingsVersion,
      results: 1,
    },
    command: {
      type: 'generate-draw',
      tabRoundId: roundId,
      resultCutoff: 0,
      seed: 'fa'.repeat(32),
    },
  };
  const [answer, parallel] = await Promise.all([
    generate(director, lobbyId, envelope),
    generate(director, lobbyId, {
      ...envelope,
      commandId: createId(),
      expected: {
        ...envelope.expected,
        entries: parallelEvent.entriesVersion,
        settings: parallelEvent.settingsVersion,
      },
      command: { ...envelope.command, tabRoundId: parallelEvent.roundId },
    }),
  ]);
  assert({
    given: 'concurrent first draws for two events in one tournament',
    should:
      'serialize without deadlock and accept both against one frozen snapshot',
    actual: [
      answer.kind,
      parallel.kind,
      (
        await world.sql`select count(*)::int as count from tournament_rating_snapshots where lobby_id=${lobbyId}`
      )[0]!.count,
    ],
    expected: ['accepted', 'accepted', 1],
  });
  if (answer.kind !== 'accepted')
    throw new StageFailed(`rating draw: ${JSON.stringify(answer)}`);
  const [stored] =
    await world.sql`select snapshot as rating_snapshot from tournament_rating_snapshots where lobby_id=${lobbyId}`;
  const snapshot = tournamentRatingSnapshotSchema.parse(
    stored!.rating_snapshot,
  );
  const [draw] =
    await world.sql`select inputs from draws where tab_round_id=${roundId}`;
  const inputs = draw!.inputs as { stage: { bracket: { seeds: string[] } } };
  const entrants =
    await world.sql`select e.id,m.actor_id from entries e join entry_members m on m.entry_id=e.id where e.event_id=${eventId}`;
  const seededRatings = inputs.stage.bracket.seeds.map((id) => {
    const actorId = String(
      entrants.find((row: { id: string; actor_id: string }) => row.id === id)!
        .actor_id,
    );
    return Math.round(
      snapshot.ladders
        .find((row) => row.ladderId === ladderId)!
        .actors.find((row) => row.actorId === actorId)!.rating,
    );
  });
  assert({
    given:
      'a sanctioned certified first tournament and a later single-elimination event',
    should:
      'freeze league ratings and seed every rated entrant in descending entry-rating order',
    actual: [
      snapshot.events.some(
        (row) => row.eventId === eventId && row.ladderId === ladderId,
      ),
      seededRatings.length,
      seededRatings.every(
        (rating, index) => index === 0 || seededRatings[index - 1]! >= rating,
      ),
    ],
    expected: [true, 4, true],
  });
  assert({
    given: 'another tournament scope knowing the private snapshot lobby id',
    should: 'see no snapshot under RLS',
    actual: await underFence(
      world,
      { lobbyId: world.made.get('tournament-lobby')! },
      (sql) =>
        sql`select lobby_id from tournament_rating_snapshots where lobby_id=${lobbyId}`,
    ),
    expected: [],
  });
  world.clock.advance(60);
  const replay = await generate(director, lobbyId, envelope);
  const [retained] =
    await world.sql`select snapshot as rating_snapshot from tournament_rating_snapshots where lobby_id=${lobbyId}`;
  assert({
    given: 'a lost response retried at a later time',
    should:
      'replay the draw receipt and keep the exact original tournament snapshot',
    actual: [
      replay.kind === 'accepted' && replay.receipt.replayed,
      retained!.rating_snapshot,
      await world.sql`select count(*)::int as count from rating_changes`,
    ],
    expected: [true, stored!.rating_snapshot, daisyBefore],
  });
}
