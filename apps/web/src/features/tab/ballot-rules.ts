import type {
  BallotDefinition,
  BallotDraft,
  BallotOption,
  BallotSubject,
} from './ballot-definition';

// The ballot's pure rules, apart from its reads: the judge's ballot and the
// settings editor run these in the browser, and must not carry the read's
// source with them.

/** Screening changes release policy, never the immutable authored definition. */
export const applyBallotOption = (
  definition: BallotDefinition,
  _id: BallotOption['id'],
  _value: string,
): BallotDefinition => definition;

const ballotCriteria = (definition: BallotDefinition) =>
  definition.points?.criteria.kind === 'grid'
    ? definition.points.criteria.groups.flatMap((group) => group.categories)
    : [];

/** The scale as a judge reads it: "20 to 30, in halves". */
export function pointsScaleLabel(
  points: NonNullable<BallotDefinition['points']>,
): string {
  const step =
    points.scale.step === 0.5
      ? 'in halves'
      : points.scale.step === 1
        ? 'in whole points'
        : `in steps of ${points.scale.step}`;
  return `${points.scale.min} to ${points.scale.max}, ${step}`;
}

/** The key one score is kept under: a subject's, or one criterion of it. */
const scoreKey = (subject: string, criterion: string | null): string =>
  criterion === null ? subject : `${subject}:${criterion}`;

/** A subject's points: its one score, or its criteria added up. */
export function subjectTotal(
  definition: BallotDefinition,
  points: Readonly<Record<string, number>>,
  subject: string,
): number {
  const start = definition.points?.default ?? 0;
  const criteria = ballotCriteria(definition);
  return criteria.length === 0
    ? (points[subject] ?? start)
    : criteria.reduce(
        (sum, criterion) =>
          sum + (points[scoreKey(subject, criterion.id)] ?? start),
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
  if (
    definition.points === null ||
    definition.decision.kind !== 'winner' ||
    definition.decision.lowPointWin
  )
    return null;
  const winner = subjects.find((subject) => subject.id === draft.winner);
  if (winner === undefined) return null;
  const total = (subject: BallotSubject) =>
    subjectTotal(definition, draft.points, subject.id);
  const ahead = subjects.find((subject) => total(subject) > total(winner));
  return ahead === undefined
    ? null
    : `This tournament doesn't allow the winner to have fewer points. Raise ${winner.name} or lower ${ahead.name}.`;
}
