import {
  ballotDefinitionSchema,
  formatDefinitionSchema,
  freezeBallotJudging,
  scoreUnitFor,
} from '@daisy/protocol';
import type { LoadedResultCommand } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { createDecidedResultRecord } from './result-record-factory';
import type { FixtureResultFacts } from '../commands/result';

/** Round is consulted once for original capture; every later fold consumes the result-owned record. */
export const resultFacts = (
  loaded: LoadedResultCommand,
  context: {
    readonly now: string;
    readonly commandId: string;
    readonly resultId: string;
  },
): FixtureResultFacts => {
  const { fixture, configuration, progress } = loaded;
  const played = progress?.competition
    ? createDecidedResultRecord(
        progress.competition,
        { kind: fixture.kind, entries: loaded.entries },
        loaded.judges,
      )
    : null;
  if (played?.kind === 'refused')
    throw createAppError(
      'INVARIANT',
      'Published competition cannot bind its immutable fixture',
    );
  const pin = loaded.room ?? configuration.event;
  const frozen = freezeBallotJudging(
    loaded.room?.rules ??
      formatDefinitionSchema.parse(configuration.definition.definition),
    loaded.ballot
      ? {
          source: {
            kind: 'stored',
            id: loaded.ballot.ballotDefinitionId,
            version: loaded.ballot.version,
          },
          ballot: ballotDefinitionSchema.parse(loaded.ballot.definition),
        }
      : null,
  );
  if (
    frozen.kind !== 'frozen' ||
    !frozen.judging ||
    (pin.ballotDefinitionId !== null && !loaded.ballot)
  )
    throw createAppError('CONFLICT', 'Ballot definition unavailable');
  const judging = frozen.judging;
  const completed = played?.kind === 'created' ? played.record : null;
  const members = completed
    ? completed.cast.flatMap((person) =>
        person.entryId
          ? [{ entryId: person.entryId, actorId: person.actorId }]
          : [],
      )
    : loaded.members;
  return {
    commandId: context.commandId,
    now: context.now,
    mintedResultId: context.resultId,
    fixture,
    entries: loaded.entries,
    members,
    panel: [],
    ballots: [],
    round: progress?.round ?? null,
    results: loaded.results.map((row) => ({
      ...row,
      recordedAt: row.recordedAt.toISOString(),
    })),
    completedCompetition: completed,
    administrativeContext: {
      format: {
        formatId: configuration.event.formatId,
        formatVersion: configuration.event.formatVersion,
      },
      ballotSource: judging.source,
      definition: judging.ballot,
      pointUnit: judging.ballot.points
        ? scoreUnitFor(judging.ballot.points)
        : null,
      sourceRoundId: progress?.round.id ?? null,
      fixture: {
        kind: fixture.kind,
        entries: loaded.entries.map((entry) => ({
          entryId: entry.entryId,
          side: entry.side,
          members: members
            .filter((member) => member.entryId === entry.entryId)
            .map((member) => member.actorId),
        })),
      },
    },
  };
};
