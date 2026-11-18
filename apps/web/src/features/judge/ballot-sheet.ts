import {
  isLowPointWin,
  pointsTotal,
  scoreLatticeSize,
  scoreValueAt,
  sumScoreValues,
} from '@daisy/protocol';
import {
  lowPointKey,
  pointsField,
  readScore,
  scoreField,
  subjectScale,
  type BallotPoints,
} from './ballot';
import type { BallotPlan } from './ballot-plan';

/**
 * The score sheet a definition's points draw (TAB-6.17): its criteria in
 * groups, or one holistic row, each scored per subject on the definition's
 * scale. Pure, so the form, its read-outs and the tests agree.
 */
export type SheetRow = {
  readonly id: string;
  readonly name: string;
  /** What the criterion rewards; null for a holistic score. */
  readonly rewards: string | null;
  /** What a score looks like at a few levels of the scale. */
  readonly anchors: readonly {
    readonly level: number;
    readonly text: string;
  }[];
  /** The posted field for one subject's score in this row. */
  readonly field: (subject: string) => string;
};
export type SheetGroup = {
  readonly id: string;
  /** Null for the holistic row, which has no group heading. */
  readonly name: string | null;
  readonly rows: readonly SheetRow[];
};
/** Each scored subject's score in each row, by subject key then row id. */
export type SheetScores = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

/** The row id a holistic score is held under. */
const holisticRow = 'points';

/** Anchor levels spread evenly over the scale: 1, 3 and 5 for three anchors on 1–5. */
const anchorLevels = (scale: BallotPoints['scale'], count: number) => {
  const size = scoreLatticeSize(scale);
  if (size === null) return [];
  return Array.from({ length: count }, (_, index) =>
    scoreValueAt(
      scale,
      count === 1 ? size - 1 : Math.round((index * (size - 1)) / (count - 1)),
    )!,
  );
};

export function sheetGroupsOf(points: BallotPoints): readonly SheetGroup[] {
  switch (points.criteria.kind) {
    case 'grid':
      return points.criteria.groups.map((group) => ({
        id: group.id,
        name: group.name,
        rows: group.categories.map((category) => {
          const levels = anchorLevels(points.scale, category.anchors.length);
          return {
            id: category.id,
            name: category.name,
            rewards: category.rewards,
            anchors: category.anchors.map((text, index) => ({
              level: levels[index] ?? points.scale.max,
              text,
            })),
            field: (subject: string) => scoreField(subject, category.id),
          };
        }),
      }));
    case 'holistic':
      return [
        {
          id: holisticRow,
          name: null,
          rows: [
            {
              id: holisticRow,
              name: 'Score',
              rewards: null,
              anchors: [],
              field: pointsField,
            },
          ],
        },
      ];
  }
}

const rowsOf = (points: BallotPoints) =>
  sheetGroupsOf(points).flatMap((group) => group.rows);

/** The most a subject can score: every row at the top of the scale. */
export const sheetMax = (points: BallotPoints): number =>
  sumScoreValues(
    Array.from({ length: rowsOf(points).length }, () => {
      const count = scoreLatticeSize(points.scale);
      return count === null
        ? Number.NaN
        : scoreValueAt(points.scale, count - 1)!;
    }),
  );

/** One subject's total across its rows. */
export const sheetTotal = (
  scores: Readonly<Record<string, number>> | undefined,
): number => sumScoreValues(Object.values(scores ?? {}));

/** The sheet as posted last time, or every score at its start value. */
export function postedSheet(
  plan: BallotPlan,
  values: Readonly<Record<string, string>>,
): SheetScores {
  const { points } = plan.definition;
  if (!points) return {};
  return Object.fromEntries(
    plan.scored.map((subject) => [
      subject.key,
      Object.fromEntries(
        rowsOf(points).map((row) => [
          row.id,
          readScore(
            subjectScale(points, subject.key).scale,
            values[row.field(subject.key)],
          ) ?? subjectScale(points, subject.key).default,
        ]),
      ),
    ]),
  );
}

/** "What a 1, 3 and 5 look like": the levels a row's anchors describe. */
export const anchorsSummary = (row: SheetRow): string => {
  const levels = row.anchors.map((anchor) => String(anchor.level));
  const list =
    levels.length > 1
      ? `${levels.slice(0, -1).join(', ')} and ${levels.at(-1)}`
      : (levels[0] ?? '');
  return `What a ${list} look like`;
};

/**
 * A pick that wins on fewer points, where the definition allows it and so
 * asks for a confirmation: what to say and the result the confirmation is
 * for. Null for any other pick.
 */
export function lowPointOf(
  plan: BallotPlan,
  winner: string | null,
  scores: SheetScores,
): { readonly text: string; readonly key: string } | null {
  const { decision, points } = plan.definition;
  if (
    winner === null ||
    decision.kind !== 'winner' ||
    !decision.lowPointWin ||
    points?.per !== 'side' ||
    !isLowPointWin(winner, scores)
  )
    return null;
  const name = plan.decided.find((subject) => subject.key === winner)?.name;
  const best = Math.max(
    ...plan.subjects.sides
      .filter((side) => side !== winner)
      .map((side) => pointsTotal(scores[side] ?? 0)),
  );
  return {
    text: `${name} wins with fewer points: ${pointsTotal(scores[winner] ?? 0)} to ${best}`,
    key: lowPointKey(winner, scores, plan.subjects.sides),
  };
}
