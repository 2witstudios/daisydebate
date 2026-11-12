import { z } from 'zod';
import { debateSideSchema, debateSides } from './primitives';
import { ballotRubrics, type BallotRubricVersion } from './ballot-rubrics';

/**
 * The speaker rubric every ballot scores against, human or AI. Ten
 * categories in four groups; each debater gets 1–5 in each. The anchors say
 * what a 1, a 3 and a 5 look like; 2 and 4 sit between them. The version is
 * stored with every ballot, so a later rubric never re-reads an old one:
 * every version stays as data in `ballot-rubrics.ts`, and only the current
 * one is written.
 */
export { ballotRubrics, type BallotRubricVersion };
export const ballotRubricVersions = Object.keys(
  ballotRubrics,
) as readonly BallotRubricVersion[];

/** The rubric every new ballot is written on. */
export const ballotRubricVersion = 'speaker-10@2' satisfies BallotRubricVersion;
export const ballotRubric = ballotRubrics[ballotRubricVersion];

type CategoryOf<V extends BallotRubricVersion> =
  (typeof ballotRubrics)[V][number]['categories'][number]['id'];
/** A rubric version's ten category ids, in rubric order. */
export const rubricCategories = <V extends BallotRubricVersion>(
  version: V,
): readonly CategoryOf<V>[] =>
  ballotRubrics[version].flatMap((group) =>
    group.categories.map((category) => category.id),
  ) as readonly CategoryOf<V>[];

/** The current rubric's ten category ids, in rubric order. */
export const ballotCategories = [
  'thesis',
  'burdens',
  'warrants',
  'coherence',
  'refutation',
  'weighing',
  'questioning',
  'answering',
  'organization',
  'delivery',
] as const satisfies readonly CategoryOf<typeof ballotRubricVersion>[];
export type BallotCategory = (typeof ballotCategories)[number];

/** The score every category starts at on a new ballot. */
export const ballotDefaultScore = 3;
export const ballotScoreMax = 5;
const ballotReasonMax = 600;
const ballotFeedbackMax = 280;

const scoreSchema = z.int().min(1).max(ballotScoreMax);
const citationSchema = z.strictObject({
  turn: z.string().trim().min(1).max(8),
  note: z.string().trim().min(1).max(200),
});

const versionSchemas = <const C extends readonly [string, ...string[]]>(
  categories: C,
) => {
  const category = z.enum(categories);
  return {
    scores: z.record(debateSideSchema, z.record(category, scoreSchema)),
    citations: z.partialRecord(
      debateSideSchema,
      z.partialRecord(category, citationSchema),
    ),
  };
};
const current = versionSchemas(ballotCategories);
const v1 = versionSchemas([
  'thesis',
  'framework',
  'analysis',
  'refutation',
  'impact',
  'weighing',
  'questioning',
  'answering',
  'organization',
  'delivery',
] as const satisfies readonly CategoryOf<'speaker-10@1'>[]);

/**
 * The numeric scoring portion of the ballot contract alone, on the current
 * rubric: what a new ballot writes to the `ballots.scores` column (ADR 0058).
 */
export const ballotScoresSchema = current.scores;
/** What the `ballots.scores` column holds: scores on any rubric version. */
export const storedBallotScoresSchema = z.union([current.scores, v1.scores]);

/** The per-side feedback the ballot may carry, as its column stores it. */
export const ballotFeedbackSchema = z.partialRecord(
  debateSideSchema,
  z.string().trim().min(1).max(ballotFeedbackMax),
);

/** The turn behind each score, as a new ballot writes it. */
export const ballotCitationsSchema = current.citations;
/** What the `ballots.citations` column holds, on any rubric version. */
export const storedBallotCitationsSchema = z.union([
  current.citations,
  v1.citations,
]);

const ballotFields = {
  winner: debateSideSchema,
  reason: z.string().trim().min(1).max(ballotReasonMax),
  feedback: ballotFeedbackSchema,
};

/**
 * One judge's ballot, as every write path accepts it: on the current rubric
 * only. The judge picks a winner (there are no draws), scores every category
 * for both sides, and gives a reason both debaters see. Feedback for each
 * debater is optional. An AI ballot adds the turn behind each score as
 * citations.
 */
export const ballotSchema = z.strictObject({
  rubricVersion: z.literal(ballotRubricVersion),
  ...ballotFields,
  scores: current.scores,
  citations: current.citations.optional(),
});
export type Ballot = z.infer<typeof ballotSchema>;

/**
 * A ballot as it is read back: on the rubric version it was written on, with
 * that version's categories.
 */
export const storedBallotSchema = z.discriminatedUnion('rubricVersion', [
  ballotSchema,
  z.strictObject({
    rubricVersion: z.literal('speaker-10@1'),
    ...ballotFields,
    scores: v1.scores,
    citations: v1.citations.optional(),
  }),
]);
export type StoredBallot = z.infer<typeof storedBallotSchema>;

/** One side's speaker score: the sum of its ten category scores, out of 50. */
export const speakerTotal = (
  scores: Readonly<Record<string, number>>,
): number => Object.values(scores).reduce((sum, score) => sum + score, 0);

/** True when the winner's speaker score is lower than the loser's. */
export const isLowPointWin = (
  winner: (typeof debateSides)[number],
  scores: Readonly<
    Record<(typeof debateSides)[number], Readonly<Record<string, number>>>
  >,
): boolean => {
  const loser = debateSides.find((side) => side !== winner) ?? winner;
  return speakerTotal(scores[winner]) < speakerTotal(scores[loser]);
};

export const ballotLimits = {
  reason: ballotReasonMax,
  feedback: ballotFeedbackMax,
} as const;
