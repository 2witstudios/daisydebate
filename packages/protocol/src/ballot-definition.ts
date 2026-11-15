import { z } from 'zod';
import { idSchema } from './primitives';
import { ballotRubrics } from './ballot-rubrics';
import { ballotDefaultScore, ballotLimits, ballotScoreMax } from './ballot';
import { isDebatingSeat, type SideKey } from './seats';
import type { RoundRules } from './format';
import { isScoreOnScale, scoreUnitFor, scoreCapacity } from './score-unit';

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
  /** A group id may hyphenate, as Daisy's `cross-ex` group does. */
  id: z.string().regex(/^[a-z][a-z_-]{0,31}$/),
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

const ballotDefinitionFields = {
  decision: ballotDecisionSchema,
  points: ballotPointsSchema.nullable(),
  /** Whether a winner ballot also ranks the actual speakers. */
  speakerRanks: z.boolean(),
  /** Null explicitly disables collection; non-null keeps required/optional bounds. */
  written: z.strictObject({
    reason: lengthSchema.nullable(),
    feedback: lengthSchema.nullable(),
  }),
};
const ballotBodyShape = z.strictObject(ballotDefinitionFields);
type Body = z.infer<typeof ballotBodyShape>;
const validateBallotBody = (body: Body, ctx: z.RefinementCtx) => {
  if (body.speakerRanks && body.decision.kind !== 'winner')
    ctx.addIssue({
      code: 'custom',
      path: ['speakerRanks'],
      message: 'Only a winner ballot separately ranks speakers',
    });
  const parsed =
    body.points === null ? null : ballotPointsSchema.safeParse(body.points);
  if (!parsed?.success) return;
  const points = parsed.data;
  if (!isScoreOnScale(points.default, points.scale))
    ctx.addIssue({
      code: 'custom',
      path: ['points', 'default'],
      message: 'The default is on the declared score lattice',
    });
  if (points.per !== 'speech' && points.weights !== null)
    ctx.addIssue({
      code: 'custom',
      path: ['points', 'weights'],
      message: 'Only individual speeches have segment weights',
    });
  if (points.criteria.kind === 'grid') {
    const groups = points.criteria.groups;
    const ids = groups.flatMap((group) =>
      group.categories.map((category) => category.id),
    );
    if (
      new Set(groups.map((group) => group.id)).size !== groups.length ||
      new Set(ids).size !== ids.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['points', 'criteria'],
        message: 'Criterion and group identities are distinct and stable',
      });
  }
};
/** Authoring is the canonical body, without server-owned immutable identity. */
export const ballotDefinitionBodySchema =
  ballotBodyShape.superRefine(validateBallotBody);
export type BallotDefinitionBody = z.infer<typeof ballotDefinitionBodySchema>;
export const ballotDefinitionSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    revision: z.int().positive(),
    ...ballotDefinitionFields,
  })
  .superRefine(validateBallotBody);
export type BallotDefinition = z.infer<typeof ballotDefinitionSchema>;

/** Every version of a stored identity keeps its key, independently of its display name. */
export const storedBallotDefinition = (
  id: string,
  version: number,
  body: BallotDefinitionBody,
): BallotDefinition => ({
  key: `ballot-${id}`,
  revision: version,
  decision: body.decision,
  points: body.points,
  speakerRanks: body.speakerRanks,
  written: body.written,
});

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

/** An explicit immutable stored definition version; null elsewhere means the format's ballot. */
export const ballotDefinitionPinSchema = z.strictObject({
  id: idSchema,
  version: z.int().positive(),
});
export type BallotDefinitionPin = z.infer<typeof ballotDefinitionPinSchema>;

/** The immutable source answered by every human or AI ballot. */
export const ballotDefinitionSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('daisy'),
    key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    revision: z.int().positive(),
  }),
  z.strictObject({
    kind: z.literal('stored'),
    ...ballotDefinitionPinSchema.shape,
  }),
]);
export type BallotDefinitionSource = z.infer<
  typeof ballotDefinitionSourceSchema
>;

/** A reference to an actual registry definition; the frozen schema verifies its content. */
export const daisyBallotSource = (
  definition: BallotDefinition,
): Extract<BallotDefinitionSource, { kind: 'daisy' }> => ({
  kind: 'daisy',
  key: definition.key,
  revision: definition.revision,
});

/** What a Round is judged on, frozen at Start round; null when nothing is judged. */
export const roundJudgingSchema = z
  .strictObject({
    source: ballotDefinitionSourceSchema,
    ballot: ballotDefinitionSchema,
    panel: panelRuleSchema,
  })
  .superRefine((judging, ctx) => {
    const source = judging.source;
    if (source.kind === 'stored') {
      if (source.version !== judging.ballot.revision)
        ctx.addIssue({
          code: 'custom',
          message: 'The stored content has its exact immutable version',
        });
      return;
    }
    const original = Object.values(daisyBallotDefinitions).find(
      (definition) =>
        definition.key === source.key &&
        definition.revision === source.revision,
    );
    if (
      !original ||
      JSON.stringify(ballotDefinitionSchema.parse(original)) !==
        JSON.stringify(judging.ballot)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'The Daisy source names its exact registered content',
      });
  })
  .nullable();
export type RoundJudging = z.infer<typeof roundJudgingSchema>;

/**
 * The panel rule a definition's decision implies over a Round's judge seats:
 * a winner by majority, a ranking by rank sum, and a quorum of half the
 * seats, rounded up (one of one or two, two of three), so a panel that
 * mostly did not rule gives no outcome (`below-quorum`). Half, not a strict
 * majority: one judge of two still decides beside a silent one (DEC-201,
 * DEC-207).
 */
export const panelRuleFor = (
  definition: BallotDefinition,
  judgeSeats = 1,
): PanelRule => ({
  decision: definition.decision.kind === 'winner' ? 'majority' : 'rank_sum',
  quorum: Math.max(1, Math.ceil(judgeSeats / 2)),
});

/** Who a ballot is about, read from the Round: its sides, its speaker seats and its segments. */
export type BallotSubjects = {
  readonly sides: readonly SideKey[];
  /** The round participant ids of every competitor seat, sided or not. */
  readonly speakers: readonly string[];
  readonly segments: readonly string[];
};

export type BallotJudgingSelection = {
  readonly source: BallotDefinitionSource;
  readonly ballot: BallotDefinition;
};
/** The shared authored and frozen execution geometry a ballot binds to. */
export type BallotExecutionGeometry = Pick<
  RoundRules,
  'sides' | 'seats' | 'outcome'
> & {
  readonly segments: readonly Pick<
    RoundRules['segments'][number],
    'key' | 'speak'
  >[];
};
export type BallotJudgingFreeze =
  | { readonly kind: 'frozen'; readonly judging: RoundJudging }
  | {
      readonly kind: 'refused';
      readonly refusal: 'ballot-definition-unavailable';
    };

/** Bind an exact immutable definition to actual execution subjects; never substitute a non-null selection. */
export const freezeBallotJudging = (
  rules: BallotExecutionGeometry,
  selection: BallotJudgingSelection | null,
): BallotJudgingFreeze => {
  const refused = {
    kind: 'refused',
    refusal: 'ballot-definition-unavailable',
  } as const;
  const ballot = selection ? selection.ballot : daisyBallotFor(rules.outcome);
  if (!ballot) return { kind: 'frozen', judging: null };
  const parsed = roundJudgingSchema.safeParse({
    source: selection ? selection.source : daisyBallotSource(ballot),
    ballot,
    panel: panelRuleFor(ballot, rules.seats.judges),
  });
  if (!parsed.success || !parsed.data) return refused;
  const definition = parsed.data.ballot;
  if (
    rules.outcome.kind !== definition.decision.kind ||
    (rules.outcome.kind === 'ranking' &&
      definition.decision.kind === 'ranking' &&
      rules.outcome.of !== definition.decision.of)
  )
    return refused;
  const speakers =
    rules.seats.speakers +
    Object.values(rules.seats.sides).reduce((sum, count) => sum + count, 0);
  if (definition.speakerRanks && speakers === 0) return refused;
  const points = definition.points;
  if (points) {
    const unit = scoreUnitFor(points);
    if (!unit || !isScoreOnScale(points.default, points.scale)) return refused;
    if (
      points.per === 'speech' &&
      rules.segments.some(
        (segment) =>
          segment.speak.rights !== 'one' || !isDebatingSeat(segment.speak.seat),
      )
    )
      return refused;
    if (
      Object.keys(points.weights ?? {}).some(
        (key) =>
          points.per !== 'speech' ||
          !rules.segments.some((segment) => segment.key === key),
      )
    )
      return refused;
    const subjects =
      points.per === 'side'
        ? rules.sides.length
        : points.per === 'seat'
          ? speakers
          : rules.segments.length;
    if (subjects === 0) return refused;
    const criteria =
      points.criteria.kind === 'grid'
        ? points.criteria.groups.flatMap((group) => group.categories)
        : [];
    if (
      new Set(criteria.map((criterion) => criterion.id)).size !==
      criteria.length
    )
      return refused;
    const weights =
      points.per === 'speech'
        ? [1, ...Object.values(points.weights ?? {})]
        : [1];
    for (const weight of weights) {
      const bound = scoreCapacity(points.scale.max, unit, weight);
      if (
        bound === null ||
        BigInt(bound) *
          BigInt(Math.max(1, criteria.length)) *
          BigInt(subjects) >
          BigInt(Number.MAX_SAFE_INTEGER)
      )
        return refused;
    }
  }
  return { kind: 'frozen', judging: parsed.data };
};
