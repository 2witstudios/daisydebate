import { z } from 'zod';
import { ballotRubrics } from './ballot-rubrics';
import { ballotDefaultScore, ballotLimits, ballotScoreMax } from './ballot';
import type { SideKey } from './seats';

/**
 * A ballot definition (TAB-6.11): the typed settings of a ballot as data,
 * versioned by `key@revision`. A Round freezes the definition it is judged
 * on; one pure function turns it into the one schema every ballot, human or
 * AI, validates against (ADR 0058's one ballot contract).
 */

const criterionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z_]{0,31}$/),
  name: z.string().trim().min(1).max(60),
  rewards: z.string().trim().min(1).max(120),
  anchors: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
});
const criteriaGroupSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z_]{0,31}$/),
  name: z.string().trim().min(1).max(60),
  categories: z.array(criterionSchema).min(1).max(20),
});

const scaleSchema = z
  .strictObject({
    min: z.number().min(0).max(1000),
    max: z.number().min(0).max(1000),
    step: z.number().positive().max(100),
  })
  .refine((scale) => scale.min < scale.max, 'A scale runs upward');

const lengthSchema = z.strictObject({
  required: z.boolean(),
  max: z.int().min(1).max(5000),
});

export const ballotDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('winner'),
    /** Whether the winner may hold fewer points than the loser. */
    lowPointWin: z.boolean(),
    tie: z.boolean(),
    doubleLoss: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('ranking'),
    of: z.enum(['sides', 'speakers']),
    /** Whether two subjects may share a place. */
    ties: z.boolean(),
  }),
]);
export type BallotDecision = z.infer<typeof ballotDecisionSchema>;

export const ballotPointsSchema = z.strictObject({
  /** What one score is given to: a side, a speaker's seat, or one speech. */
  per: z.enum(['side', 'seat', 'speech']),
  scale: scaleSchema,
  default: z.number(),
  /** A grid of criteria scored separately, or one holistic score. */
  criteria: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('grid'),
      groups: z.array(criteriaGroupSchema).min(1).max(10),
    }),
    z.strictObject({ kind: z.literal('holistic') }),
  ]),
  /** A segment key's scale multiplier (a reply speech scored at half). */
  weights: z.record(z.string().min(1).max(8), z.number().positive()).nullable(),
});
export type BallotPoints = z.infer<typeof ballotPointsSchema>;

export const ballotDefinitionIdentityPattern =
  /^[a-z][a-z0-9-]{0,39}@[1-9]\d*$/;

export const ballotDefinitionSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  revision: z.int().positive(),
  decision: ballotDecisionSchema,
  points: ballotPointsSchema.nullable(),
  /** Whether a winner ballot also ranks the speakers. */
  speakerRanks: z.boolean(),
  written: z.strictObject({ reason: lengthSchema, feedback: lengthSchema }),
});
export type BallotDefinition = z.infer<typeof ballotDefinitionSchema>;

/** A definition's one identity, as a ballot and a Round store it. */
export const ballotDefinitionIdentity = (
  definition: Pick<BallotDefinition, 'key' | 'revision'>,
): string => `${definition.key}@${definition.revision}`;

/** Daisy's written fields: a required reason, optional feedback per subject. */
const daisyWritten: BallotDefinition['written'] = {
  reason: { required: true, max: ballotLimits.reason },
  feedback: { required: false, max: ballotLimits.feedback },
};

const speakerTen = (revision: 1 | 2): BallotDefinition => ({
  key: 'speaker-10',
  revision,
  decision: {
    kind: 'winner',
    lowPointWin: true,
    tie: false,
    doubleLoss: false,
  },
  points: {
    per: 'side',
    scale: { min: 1, max: ballotScoreMax, step: 1 },
    default: ballotDefaultScore,
    criteria: {
      kind: 'grid',
      groups: ballotRubrics[`speaker-10@${revision}`].map((group) => ({
        id: group.id,
        name: group.name,
        categories: group.categories.map((category) => ({
          id: category.id,
          name: category.name,
          rewards: category.rewards,
          anchors: [...category.anchors],
        })),
      })),
    },
    weights: null,
  },
  speakerRanks: false,
  written: daisyWritten,
});

const ranking = (key: string, of: 'sides' | 'speakers'): BallotDefinition => ({
  key,
  revision: 1,
  decision: { kind: 'ranking', of, ties: false },
  points: null,
  speakerRanks: false,
  written: daisyWritten,
});

/**
 * Daisy's own ballot definitions. An ordinary Room is judged on the one its
 * format's outcome kind implies (decision 29); a host's definition reaches a
 * Room through its plan instead. `speaker-10@1` is history only: no new
 * ballot is written on it.
 */
export const daisyBallotDefinitions = {
  'speaker-10@1': speakerTen(1),
  'speaker-10@2': speakerTen(2),
  'rank-sides@1': ranking('rank-sides', 'sides'),
  'rank-speakers@1': ranking('rank-speakers', 'speakers'),
} as const satisfies Record<string, BallotDefinition>;
export type DaisyBallotDefinitionId = keyof typeof daisyBallotDefinitions;
export const daisyBallotDefinitionIds = Object.keys(
  daisyBallotDefinitions,
) as readonly DaisyBallotDefinitionId[];

/** The current Daisy winner ballot every two-sided Room is judged on. */
export const daisyWinnerBallot = daisyBallotDefinitions['speaker-10@2'];

/**
 * The definition an ordinary Room's outcome kind implies, or null when
 * nothing is judged.
 */
export const daisyBallotFor = (
  outcome:
    | { readonly kind: 'winner' }
    | { readonly kind: 'ranking'; readonly of: 'sides' | 'speakers' }
    | { readonly kind: 'none' },
): BallotDefinition | null => {
  switch (outcome.kind) {
    case 'winner':
      return daisyWinnerBallot;
    case 'ranking':
      return outcome.of === 'sides'
        ? daisyBallotDefinitions['rank-sides@1']
        : daisyBallotDefinitions['rank-speakers@1'];
    case 'none':
      return null;
  }
};

/** How a panel turns its ballots into a Round outcome, frozen with the definition. */
export const panelRuleSchema = z.strictObject({
  decision: z.enum(['majority', 'rank_sum']),
  /** Fewer submitted ballots than this gives no outcome. */
  quorum: z.int().min(1).max(256),
});
export type PanelRule = z.infer<typeof panelRuleSchema>;

/** What a Round is judged on, frozen at Start round; null when nothing is judged. */
export const roundJudgingSchema = z
  .strictObject({ ballot: ballotDefinitionSchema, panel: panelRuleSchema })
  .nullable();
export type RoundJudging = z.infer<typeof roundJudgingSchema>;

/** The panel rule a definition's decision implies: a winner by majority, a ranking by rank sum. */
export const panelRuleFor = (definition: BallotDefinition): PanelRule => ({
  decision: definition.decision.kind === 'winner' ? 'majority' : 'rank_sum',
  quorum: 1,
});

/** Who a ballot is about, read from the Round: its sides, its speaker seats and its segments. */
export type BallotSubjects = {
  readonly sides: readonly SideKey[];
  /** The round participant ids of every competitor seat, sided or not. */
  readonly speakers: readonly string[];
  readonly segments: readonly string[];
};
