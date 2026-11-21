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
  );

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

/** One subject's speaker score: the sum of its category scores, out of 50 on speaker-10. */
export const speakerTotal = (
  scores: Readonly<Record<string, number>>,
): number => Object.values(scores).reduce((sum, score) => sum + score, 0);

export const ballotLimits = {
  reason: ballotReasonMax,
  feedback: ballotFeedbackMax,
} as const;
