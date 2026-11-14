import type {
  BallotDefinition,
  BallotDraft,
  BallotOption,
  BallotSubject,
  WrittenRule,
} from './ballot-definition';

// The ballot's pure rules, apart from its reads: the judge's ballot and the
// settings editor run these in the browser, and must not carry the read's
// source with them.

const isWrittenRule = (value: string): value is WrittenRule =>
  value === 'required' || value === 'optional' || value === 'off';

/** The definition after a host chooses `value` for one part of the ballot. */
export function applyBallotOption(
  definition: BallotDefinition,
  id: BallotOption['id'],
  value: string,
): BallotDefinition {
  switch (id) {
    case 'ranks':
      return { ...definition, ranks: value === 'on' };
    case 'criteria':
      return {
        ...definition,
        criteria: value === 'grid' ? ['Argument', 'Evidence', 'Delivery'] : [],
      };
    case 'doubleLoss':
      return {
        ...definition,
        outcomes: { ...definition.outcomes, doubleLoss: value !== 'never' },
      };
    case 'reason':
    case 'feedback':
      return isWrittenRule(value)
        ? { ...definition, written: { ...definition.written, [id]: value } }
        : definition;
    case 'privateNote':
      return value === 'optional' || value === 'off'
        ? {
            ...definition,
            written: { ...definition.written, privateNote: value },
          }
        : definition;
    // Screening decides what is held back from release, never what a judge is asked.
    case 'screening':
      return definition;
  }
}

/** The scale as a judge reads it: "20 to 30, in halves". */
export function pointsScaleLabel(
  points: NonNullable<BallotDefinition['points']>,
): string {
  const step =
    points.step === 0.5
      ? 'in halves'
      : points.step === 1
        ? 'in whole points'
        : `in steps of ${points.step}`;
  return `${points.min} to ${points.max}, ${step}`;
}

/** The key one score is kept under: a subject's, or one criterion of it. */
export const scoreKey = (subject: string, criterion: string | null): string =>
  criterion === null ? subject : `${subject}:${criterion}`;

/** A subject's points: its one score, or its criteria added up. */
export function subjectTotal(
  definition: BallotDefinition,
  points: Readonly<Record<string, number>>,
  subject: string,
): number {
  const start = definition.points?.min ?? 0;
  return definition.criteria.length === 0
    ? (points[subject] ?? start)
    : definition.criteria.reduce(
        (sum, criterion) =>
          sum + (points[scoreKey(subject, criterion)] ?? start),
        0,
      );
}

/**
 * Why this ballot cannot be submitted as it stands, in words that say what
 * to do; null when it can.
 */
export function ballotProblem(
  definition: BallotDefinition,
  subjects: readonly BallotSubject[],
  draft: Pick<BallotDraft, 'winner' | 'points'>,
): string | null {
  if (definition.points === null || definition.points.lowPointWin) return null;
  const winner = subjects.find((subject) => subject.id === draft.winner);
  if (winner === undefined) return null;
  const total = (subject: BallotSubject) =>
    subjectTotal(definition, draft.points, subject.id);
  const ahead = subjects.find((subject) => total(subject) > total(winner));
  return ahead === undefined
    ? null
    : `This tournament doesn't allow the winner to have fewer points. Raise ${winner.name} or lower ${ahead.name}.`;
}
