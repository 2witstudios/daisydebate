import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { resultCompetitionRecordSchema } from '@daisy/protocol/lobby/result-record';
import { assert } from 'riteway/bun';
import { readLeagueSeason } from '../src/features/tab/reads/league-season';
import { eventResultCommand } from '../src/features/tab/operations/event-result-command';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

export async function seasonCorrection(world: World) {
  const store = createTabStore(world.database),
    principal = as(world.bots.Director!);
  const organizationId = world.made.get('league')!,
    lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!,
    seasonId = world.made.get('league-season')!,
    templateId = world.made.get('league-template')!;
  const read = readLeagueSeason({ store, authorize }),
    input = { organizationId, seasonId, templateId };
  const before = await read(principal, input);
  const [source] =
    await world.sql`select r.id,r.fixture_id,r.competition_record,f.version from results r join fixtures f on f.id=r.fixture_id join tab_rounds tr on tr.id=f.tab_round_id join stages s on s.id=tr.stage_id where r.event_id=${eventId} and s.kind='preliminary' and r.kind='decided' and not exists(select 1 from results later where later.supersedes_result_id=r.id) order by r.id limit 1`;
  if (!source)
    throw new Error(
      'No genuine preliminary result for certification boundary proof',
    );
  const record = resultCompetitionRecordSchema.parse(source.competition_record);
  if (record.kind !== 'decided')
    throw new Error('Expected genuine decided result');
  const contributions = record.panel.flatMap((judge) =>
    judge.ballot.kind === 'submitted' && 'winner' in judge.ballot.contribution
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
  );
  const command = eventResultCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const corrected = await command(principal, lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { fixture: Number(source.version) },
    command: {
      type: 'correct-result',
      fixtureId: String(source.fixture_id),
      supersedesResultId: String(source.id),
      reason: 'League certification boundary: the host corrects the winner.',
      replacement: { kind: 'decided', contributions },
    },
  });
  if (corrected.kind !== 'accepted')
    throw new Error(`Certified correction: ${JSON.stringify(corrected)}`);
  assert({
    given: 'a genuine correction after the league received certification',
    should:
      'keep league standings on the previous certified results until recertification',
    actual: (await read(principal, input))?.view.standings.rows,
    expected: before?.view.standings.rows,
  });
  const [guard] =
    await world.sql`select 1+(select count(*)::int from results where event_id=${eventId})+(select count(*)::int from certifications where event_id=${eventId}) version`;
  const certified = await command(principal, lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { results: Number(guard!.version) },
    command: { type: 'certify-event', eventId },
  });
  if (certified.kind !== 'accepted')
    throw new Error(`Recertify corrected event: ${JSON.stringify(certified)}`);
  const after = await read(principal, input);
  assert({
    given: 'the host recertifying the corrected real result',
    should: 'finally deliver the changed outcome to the season fold',
    actual:
      JSON.stringify(after?.view.standings.rows) !==
      JSON.stringify(before?.view.standings.rows),
    expected: true,
  });
  world.made.set(
    `result:${String(source.fixture_id)}`,
    corrected.receipt.aggregate.id,
  );
}
