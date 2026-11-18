import { tournamentEntryRatings } from '../../ratings/tournament-entry-ratings';
import type { EventCompetitionFacts } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { formatDefinitionSchema } from '@daisy/protocol';
import type {
  Fixture,
  Result,
  StandingsInput,
  StageHistory,
  FormatDescriptor,
} from '@daisy/tab-engine';
import { projectResultCompetition } from '../commands/result-projection';
import { engineSettings } from './engine-settings';
import { eventSettingResolution } from './event-setting-resolution';
import { eventFormatDescriptor } from './draw-facts';

/** Consume retained individual contributions, including every immutable correction. */
export function eventCompetition(
  facts: Pick<
    EventCompetitionFacts,
    | 'ratingSnapshot'
    | 'configuration'
    | 'entries'
    | 'members'
    | 'rounds'
    | 'fixtures'
    | 'fixtureEntries'
    | 'fixtureJudges'
    | 'results'
    | 'certified'
  >,
  input: {
    readonly stageIds: readonly string[];
    readonly cutoff: number;
    readonly division: string | null;
    readonly seed: Uint8Array;
  },
): StandingsInput {
  const definition = formatDefinitionSchema.parse(
    facts.configuration.definition.definition,
  );
  const format = eventFormatDescriptor(definition);
  const {
    chain,
    rows,
    format: defaults,
  } = eventSettingResolution(facts.configuration);
  const rounds = facts.rounds.filter((round) =>
    input.stageIds.includes(round.stageId),
  );
  const fixtures: StageHistory<FormatDescriptor>['fixtures'][number][] = [];
  for (const row of facts.fixtures.filter(
    (row) => row.status === 'published',
  )) {
    const round = rounds.find((round) => round.id === row.tabRoundId);
    if (!round) continue;
    const entries = facts.fixtureEntries
      .filter((one) => one.fixtureId === row.id)
      .sort((a, b) => a.position - b.position)
      .map((one) => one.entryId);
    const panel = facts.fixtureJudges
      .filter((one) => one.fixtureId === row.id)
      .sort(
        (a, b) =>
          Number(b.chair) - Number(a.chair) ||
          a.tournamentJudgeId.localeCompare(b.tournamentJudgeId),
      )
      .map((one) => one.tournamentJudgeId);
    let fixture: Fixture;
    if (row.kind === 'bye' && entries.length === 1)
      fixture = { kind: 'bye', entry: entries[0]! };
    else if (
      row.kind === 'section' &&
      format.outcome === 'ranking' &&
      format.of === 'speakers'
    )
      fixture = { kind: 'section', speakers: entries, panel };
    else if (
      row.kind === 'pairing' &&
      entries.length === 2 &&
      format.outcome === 'winner'
    )
      fixture = { kind: 'pairing', sides: [entries[0]!, entries[1]!], panel };
    else if (
      row.kind === 'pairing' &&
      entries.length === 4 &&
      format.outcome === 'ranking' &&
      format.of === 'sides'
    )
      fixture = {
        kind: 'pairing',
        sides: [entries[0]!, entries[1]!, entries[2]!, entries[3]!],
        panel,
      };
    else
      throw createAppError(
        'INVARIANT',
        'Persisted fixture does not match its pinned format',
      );
    fixtures.push({ id: row.id, tabRound: round.number, fixture });
  }
  const results: Result[] = facts.results
    .filter((row) => fixtures.some((fixture) => fixture.id === row.fixtureId))
    .map((row) => {
      const projected = projectResultCompetition(row.competitionRecord, {
        id: row.id,
        fixture: row.fixtureId,
        supersedes: row.supersedesResultId,
        certified: facts.certified.some((one) => one.resultId === row.id),
      });
      if (projected.kind !== 'projected')
        throw createAppError(
          'INVARIANT',
          'Retained result cannot be projected',
        );
      return projected.projection.engine;
    });
  return {
    format,
    entries: facts.entries
      .filter(
        (entry) =>
          entry.eventId === facts.configuration.event.id &&
          (entry.status === 'accepted' || entry.status === 'withdrawn'),
      )
      .map((entry) => ({
        id: entry.id,
        members: facts.members
          .filter((row) => row.entryId === entry.id)
          .map((row) => row.actorId),
        protection: entry.schoolOrganizationId
          ? [{ scope: 'school', key: entry.schoolOrganizationId }]
          : [],
        division: entry.division,
        status: entry.status === 'accepted' ? 'active' : 'withdrawn',
        breakEligible: true,
      })),
    history: { fixtures, results },
    settings: engineSettings(chain, rows, defaults),
    cutoff: input.cutoff,
    ratings: tournamentEntryRatings(
      facts.ratingSnapshot,
      facts.configuration.event.id,
      facts.entries.filter(
        (row) => row.eventId === facts.configuration.event.id,
      ),
      facts.members,
    ),
    division: input.division,
    seed: input.seed,
  } as StandingsInput;
}
