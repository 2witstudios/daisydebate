import { daisyWinnerBallot, daisyBallotSource } from '@daisy/protocol';
import {
  resultCompetitionRecordSchema,
  type ResultCompetitionRecord,
} from '@daisy/protocol/lobby/result-record';
/** Explicit administrative credits for schema-only constraints, never claimed judge submissions. */
export const administrativeFixtureRecord = (
  entries: readonly {
    entryId: string;
    side: string | null;
    members: readonly string[];
  }[],
  options: {
    readonly bye?: boolean;
    readonly sourceRoundId?: string;
    readonly winner?: string;
    readonly definition?: typeof daisyWinnerBallot;
    readonly source?: Extract<
      ResultCompetitionRecord,
      { kind: 'administrative' }
    >['ballotSource'];
    readonly awards?: Extract<
      ResultCompetitionRecord,
      { kind: 'administrative' }
    >['awards'];
  } = {},
) => {
  const definition = options.definition ?? daisyWinnerBallot;
  return resultCompetitionRecordSchema.parse({
    version: 1,
    kind: 'administrative',
    format: { formatId: 'policy', formatVersion: 1 },
    ballotSource: options.source ?? daisyBallotSource(definition),
    definition,
    pointUnit: {
      numerator: '1',
      denominator: definition.points?.scale.step === 0.5 ? '2' : '1',
    },
    sourceRoundId: options.sourceRoundId ?? null,
    fixture: { kind: options.bye ? 'bye' : 'pairing', entries },
    reason: options.bye ? 'bye' : 'ruling',
    awards:
      options.awards ??
      (options.bye
        ? { kind: 'bye', rule: 'own_average', panelSize: 1 }
        : {
            kind: 'winner',
            entries: entries.map((entry) => ({
              entryId: entry.entryId,
              won: entry.entryId === (options.winner ?? entries[0]?.entryId),
              ballotCredits:
                entry.entryId === (options.winner ?? entries[0]?.entryId)
                  ? 1
                  : 0,
              rankCredits: [],
              points: { kind: 'none' },
            })),
          }),
  });
};
