import type { ResultCompetitionRecord } from '@daisy/protocol/lobby/result-record';
import { projectResultCompetition } from './result-projection';
import type {
  FixtureRecord,
  ResultRowWrite,
  ResultEntryWrite,
} from './fixture';

export type ResultSpeakerWrite = {
  readonly table: 'result_speakers';
  readonly op: 'insert';
  readonly row: {
    readonly resultId: string;
    readonly actorId: string;
    readonly entryId: string;
    readonly lobbyId: string;
    readonly points: string | null;
    readonly rank: number | null;
  };
};
export type CompetitionWrite =
  ResultRowWrite | ResultEntryWrite | ResultSpeakerWrite;

/** Persist one authored record and only its deterministic relational projections in the same command transaction. */
export const resultCompetitionWrites = (
  facts: Pick<FixtureRecord, 'fixture'>,
  context: {
    readonly id: string;
    readonly commandId: string;
    readonly now: string;
    readonly supersedes: string | null;
    readonly reason: string | null;
  },
  record: ResultCompetitionRecord,
):
  | { readonly kind: 'written'; readonly writes: readonly CompetitionWrite[] }
  | { readonly kind: 'refused'; readonly refusal: 'outcome-mismatch' } => {
  const answer = projectResultCompetition(record, {
    id: context.id,
    fixture: facts.fixture.id,
    supersedes: context.supersedes,
    certified: false,
  });
  if (answer.kind === 'refused')
    return { kind: 'refused', refusal: 'outcome-mismatch' };
  const { fixture } = facts;
  return {
    kind: 'written',
    writes: [
      {
        table: 'results',
        op: 'insert',
        row: {
          id: context.id,
          lobbyId: fixture.lobbyId,
          eventId: fixture.eventId,
          tabRoundId: fixture.tabRoundId,
          fixtureId: fixture.id,
          kind: record.kind,
          administrativeReason:
            record.kind === 'administrative' ? record.reason : null,
          roundId:
            record.kind === 'decided'
              ? record.source.roundId
              : record.sourceRoundId,
          competitionRecord: record,
          supersedesResultId: context.supersedes,
          correctionReason: context.reason,
          commandId: context.commandId,
          recordedAt: context.now,
        },
      },
      ...answer.projection.entries.map((row) => ({
        table: 'result_entries' as const,
        op: 'insert' as const,
        row: {
          ...row,
          resultId: context.id,
          fixtureId: fixture.id,
          lobbyId: fixture.lobbyId,
        },
      })),
      ...answer.projection.speakers.map((row) => ({
        table: 'result_speakers' as const,
        op: 'insert' as const,
        row: {
          resultId: context.id,
          actorId: row.actorId,
          entryId: row.entryId,
          lobbyId: fixture.lobbyId,
          // SQL numeric preserves the exact rational decimal; no floating-point reconstruction.
          points:
            row.units === null || !answer.projection.pointUnit
              ? null
              : decimalPoints(row.units, answer.projection.pointUnit),
          rank: row.rank,
        },
      })),
    ],
  };
};

const decimalPoints = (
  units: number,
  unit: { readonly numerator: string; readonly denominator: string },
): string => {
  const numerator = BigInt(units) * BigInt(unit.numerator);
  const denominator = BigInt(unit.denominator);
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let decimal = '';
  while (remainder !== 0n) {
    remainder *= 10n;
    decimal += String(remainder / denominator);
    remainder %= denominator;
  }
  return decimal ? `${whole}.${decimal}` : String(whole);
};
