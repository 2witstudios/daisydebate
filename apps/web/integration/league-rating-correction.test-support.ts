import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { resultCompetitionRecordSchema } from '@daisy/protocol/lobby/result-record';
import { assert } from 'riteway/bun';
import { resultCommand } from '../src/features/tab/operations/result-command';
import { completionCommand } from '../src/features/tab/operations/completion-command';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

/** A correction crosses the certification boundary once, never the retained tournament seed. */
export async function leagueRatingCorrection(world: World) {
  const store = createTabStore(world.database);
  const principal = as(world.bots.Director!);
  const lobbyId = world.made.get('tournament-lobby')!;
  const eventId = world.made.get('event')!;
  const address = { lobbyId: world.made.get('standing-lobby')! };
  const read = readLeagueLadder({ store, authorize });
  const before = await read(principal, address);
  const snapshots =
    await world.sql`select lobby_id,snapshot from tournament_rating_snapshots order by lobby_id`;
  const [source] =
    await world.sql`select r.id,r.fixture_id,r.competition_record,f.version from results r join fixtures f on f.id=r.fixture_id where r.event_id=${eventId} and r.kind='decided' and not exists(select 1 from results later where later.supersedes_result_id=r.id) order by r.id limit 1`;
  const record = resultCompetitionRecordSchema.parse(
    source!.competition_record,
  );
  if (record.kind !== 'decided')
    throw new Error('correction proof needs a decided result');
  const corrected = await resultCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  })(principal, lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { fixture: Number(source!.version) },
    command: {
      type: 'correct-result',
      fixtureId: String(source!.fixture_id),
      supersedesResultId: String(source!.id),
      reason:
        'Correct the certified result and prove league receipt waits for certification.',
      replacement: {
        kind: 'decided',
        contributions: record.panel.flatMap((judge) =>
          judge.ballot.kind === 'submitted'
            ? [
                {
                  participantId: judge.participantId,
                  contribution: {
                    ...judge.ballot.contribution,
                    winner:
                      judge.ballot.contribution.winner === 'affirmative'
                        ? 'negative'
                        : 'affirmative',
                  },
                },
              ]
            : [],
        ),
      },
    },
  });
  if (corrected.kind !== 'accepted')
    throw new Error(`rating correction refused: ${JSON.stringify(corrected)}`);
  assert({
    given: 'an appended correction after certification',
    should:
      'retain the previously received league rating until the correction is certified',
    actual: await read(principal, address),
    expected: before,
  });
  const [guard] =
    await world.sql`select 1+(select count(*) from results where event_id=${eventId})+(select count(*) from certifications where event_id=${eventId}) as version`;
  const certified = await completionCommand({
    store,
    authorize,
    newId: createId,
  })(principal, lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { results: Number(guard!.version) },
    command: {
      type: 'certify-result',
      resultId: corrected.receipt.aggregate.id,
    },
  });
  if (certified.kind !== 'accepted')
    throw new Error(
      `rating recertification refused: ${JSON.stringify(certified)}`,
    );
  const after = await read(principal, address);
  assert({
    given: 'the correction certified through the actual completion operation',
    should:
      'change the live league rating while preserving every frozen tournament input',
    actual: [
      JSON.stringify(after) !== JSON.stringify(before),
      await world.sql`select lobby_id,snapshot from tournament_rating_snapshots order by lobby_id`,
    ],
    expected: [true, snapshots],
  });
}
