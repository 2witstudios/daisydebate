import { sumScoreValues } from './score-unit';
import { z } from 'zod';
import { isScoreOnScale, scoreBounds } from './score-unit';
import type {
  BallotDefinition,
  BallotPoints,
  BallotSubjects,
} from './ballot-definition';
import {
  ballotDefinitionIdentity,
  ballotDefinitionIdentityPattern,
  daisyBallotDefinitions,
} from './ballot-definition';
import { sideKeysOf } from './format-seating';
import { idSchema } from './primitives';
import {
  isDebatingSeat,
  seatOrder,
  sideKeySchema,
  sideOfSeat,
  type SeatRef,
} from './seats';

/**
 * The one ballot schema for a definition and a Round (TAB-6.11). Human and
 * AI ballots both validate against it. For `speaker-10@2` over two sides it
 * is exactly the ballot schema Daisy has always written: same fields, same
 * order, same bounds, so stored ballots and the AI wire schema are unchanged.
 */

const citationSchema = z.strictObject({
  turn: z.string().trim().min(1).max(8),
  note: z.string().trim().min(1).max(200),
});

type Keys = readonly [string, ...string[]];
const nonEmpty = (values: readonly string[], what: string): Keys => {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error(`A ballot needs ${what}`);
  return [first, ...rest];
};

/** Decimal steps are anchored at the exact authored minimum, including speech weights. */
const scoreOn = (scale: BallotPoints['scale'], weight = 1) => {
  const bounds = scoreBounds(scale, weight);
  if (!bounds) return z.never();
  const number =
    Number.isInteger(bounds.min) && bounds.step === 1 ? z.int() : z.number();
  const bounded = number.min(bounds.min).max(bounds.max);
  return bounded.refine(
    (value) =>
      !bounded.safeParse(value).success || isScoreOnScale(value, scale, weight),
    'The score is on the declared minimum-anchored lattice',
  );
};

const categoriesOf = (points: BallotPoints): Keys | null =>
  points.criteria.kind === 'grid'
    ? nonEmpty(
        points.criteria.groups.flatMap((group) =>
          group.categories.map((category) => category.id),
        ),
        'criteria',
      )
    : null;

/** Who a score is given to under this definition. */
const scoredSubjects = (
  points: BallotPoints,
  subjects: BallotSubjects,
): Keys => {
  switch (points.per) {
    case 'side':
      return nonEmpty(subjects.sides, 'sides to score');
    case 'seat':
      return nonEmpty(subjects.speakers, 'speakers to score');
    case 'speech':
      return nonEmpty(subjects.segments, 'speeches to score');
  }
};

const scoresSchema = (points: BallotPoints, subjects: BallotSubjects) => {
  const keys = scoredSubjects(points, subjects);
  const categories = categoriesOf(points);
  const valueFor = (key: string) => {
    const score = scoreOn(
      points.scale,
      points.per === 'speech' ? (points.weights?.[key] ?? 1) : 1,
    );
    return categories ? z.record(z.enum(categories), score) : score;
  };
  const weighted =
    points.per === 'speech' &&
    keys.some((key) => (points.weights?.[key] ?? 1) !== 1);
  return weighted
    ? z.strictObject(
        Object.fromEntries(keys.map((key) => [key, valueFor(key)])),
      )
    : z.record(z.enum(keys), valueFor(keys[0]));
};

const citationsSchema = (points: BallotPoints, subjects: BallotSubjects) => {
  const keys = z.enum(scoredSubjects(points, subjects));
  const categories = categoriesOf(points);
  return z.partialRecord(
    keys,
    categories
      ? z.partialRecord(z.enum(categories), citationSchema)
      : citationSchema,
  );
};

/** Ordered places: every subject exactly once, a shared place only where ties are allowed. */
const placesSchema = (subjects: Keys, ties: boolean) =>
  z
    .array(z.array(z.enum(subjects)).min(1).max(subjects.length))
    .min(1)
    .max(subjects.length)
    .superRefine((places, ctx) => {
      const placed = places.flat();
      if (
        placed.length !== subjects.length ||
        new Set(placed).size !== subjects.length
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Every subject is placed exactly once',
        });
      if (!ties && places.some((group) => group.length > 1))
        ctx.addIssue({
          code: 'custom',
          message: 'This ballot does not allow a shared place',
        });
    });

/** True when the decision ranks speakers, so its subjects are participants. */
const ranksSpeakers = (definition: BallotDefinition | null): boolean =>
  definition?.decision.kind === 'ranking' &&
  definition.decision.of === 'speakers';

/** The subjects a definition's decision is about. */
const decisionSubjects = (
  definition: BallotDefinition,
  subjects: BallotSubjects,
): Keys =>
  ranksSpeakers(definition)
    ? nonEmpty(subjects.speakers, 'speakers to rank')
    : nonEmpty(subjects.sides, 'sides to judge');

/**
 * The subject a seat's feedback is written under: its own round participant
 * id when the ballot ranks speakers, otherwise its side key. Null for a seat
 * no feedback is about (a judge, a moderator, or a speaker without a side
 * where sides are judged).
 */
export const feedbackSubjectOf = (
  definition: BallotDefinition | null,
  participant: { readonly id: string; readonly seat: SeatRef },
): string | null =>
  ranksSpeakers(definition)
    ? isDebatingSeat(participant.seat)
      ? participant.id
      : null
    : sideOfSeat(participant.seat);

/** A feedback subject as stored and reported: a side key or a participant id. */
export const feedbackSubjectSchema = z.union([sideKeySchema, idSchema]);

/** A subject's points total: its scores summed, criteria and all. */
export const pointsTotal = (score: unknown): number =>
  typeof score === 'number'
    ? score
    : sumScoreValues(Object.values(score as Record<string, number>));

const written = (definition: BallotDefinition, subjects: Keys) => {
  const { reason, feedback } = definition.written;
  const text = (max: number) => z.string().trim().min(1).max(max);
  return {
    ...(reason
      ? {
          reason: reason.required
            ? text(reason.max)
            : text(reason.max).optional(),
        }
      : {}),
    ...(feedback
      ? {
          feedback: feedback.required
            ? z.record(z.enum(subjects), text(feedback.max))
            : z.partialRecord(z.enum(subjects), text(feedback.max)),
        }
      : {}),
  };
};

/** The winner decision: a side, or a tie or a double loss where allowed. */
const winnerFields = (
  decision: Extract<BallotDefinition['decision'], { kind: 'winner' }>,
  sides: Keys,
) => {
  const outcomes = [
    'win',
    ...(decision.tie ? ['tie'] : []),
    ...(decision.doubleLoss ? ['double_loss'] : []),
  ] as const;
  return outcomes.length === 1
    ? { winner: z.enum(sides) }
    : {
        decision: z.enum(outcomes as unknown as Keys),
        winner: z.enum(sides).nullable(),
      };
};

/** All ballot fields before the shared decision checks are attached. */
const ballotObjectFor = (
  definition: BallotDefinition,
  subjects: BallotSubjects,
) => {
  const { decision, points } = definition;
  const about = decisionSubjects(definition, subjects);
  const writtenFields = written(definition, about);
  const shape = {
    rubricVersion: z.literal(ballotDefinitionIdentity(definition)),
    ...(decision.kind === 'winner'
      ? winnerFields(decision, about)
      : { ranking: placesSchema(about, decision.ties) }),
    ...writtenFields,
    ...(points
      ? {
          scores: scoresSchema(points, subjects),
          citations: citationsSchema(points, subjects).optional(),
        }
      : {}),
    ...(definition.speakerRanks
      ? {
          speakerRanks: placesSchema(
            nonEmpty(subjects.speakers, 'speakers to rank'),
            false,
          ),
        }
      : {}),
  };
  return z.strictObject(shape);
};

const withDecisionChecks = <Schema extends z.ZodObject>(
  schema: Schema,
  definition: BallotDefinition,
) => {
  const { decision, points } = definition;
  if (
    decision.kind !== 'winner' ||
    (decision.lowPointWin && !decision.tie && !decision.doubleLoss)
  )
    return schema;
  return schema.superRefine((ballot: Record<string, unknown>, ctx) => {
    const named = ballot['winner'] ?? null;
    if (
      'decision' in ballot &&
      (ballot['decision'] === 'win') !== (named !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'A winner is named exactly when the decision is a win',
        path: ['winner'],
      });
    if (
      !decision.lowPointWin &&
      points?.per === 'side' &&
      typeof named === 'string' &&
      isLowPointWin(
        named,
        (ballot['scores'] ?? {}) as Readonly<Record<string, unknown>>,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'This ballot does not allow a low-point win',
        path: ['winner'],
      });
  });
};

/** The strict ballot schema for one definition over one Round's subjects. */
export const ballotSchemaFor = (
  definition: BallotDefinition,
  subjects: BallotSubjects,
) => withDecisionChecks(ballotObjectFor(definition, subjects), definition);

/** Competitive history keeps decisions and scores, with no private written content. */
export const ballotCompetitionSchemaFor = (
  definition: BallotDefinition,
  subjects: BallotSubjects,
) =>
  withDecisionChecks(
    ballotObjectFor(definition, subjects).omit({
      ...(definition.written.reason ? { reason: true } : {}),
      ...(definition.written.feedback ? { feedback: true } : {}),
      ...(definition.points ? { citations: true } : {}),
    }),
    definition,
  );

/**
 * A stored ballot's schema: its Round's definition or any other revision of
 * it, so a ballot written on an earlier revision reads on that revision's
 * criteria. The stored rubric version picks which.
 */
export const storedBallotSchemaFor = (
  definition: BallotDefinition,
  subjects: BallotSubjects,
) => {
  const revisions = Object.values(daisyBallotDefinitions)
    .filter((daisy) => daisy.key === definition.key)
    .map((daisy) => ballotSchemaFor(daisy, subjects));
  const [first, ...rest] = revisions;
  return first
    ? z.discriminatedUnion('rubricVersion', [first, ...rest])
    : ballotSchemaFor(definition, subjects);
};

/**
 * Any ballot's structure, on any definition: what a message or a read row
 * carries before its Round's own schema (`ballotSchemaFor`) judges it.
 */
const ballotScoreValueSchema = z.union([
  z.number(),
  z.record(z.string(), z.number()),
]);
export const ballotRecordSchema = z.strictObject({
  rubricVersion: z.string().regex(ballotDefinitionIdentityPattern),
  decision: z.enum(['win', 'tie', 'double_loss']).optional(),
  winner: sideKeySchema.nullable().optional(),
  ranking: z.array(z.array(z.string().min(1))).optional(),
  reason: z.string().optional(),
  feedback: z.record(z.string(), z.string()).optional(),
  scores: z.record(z.string(), ballotScoreValueSchema).optional(),
  citations: z
    .record(
      z.string(),
      z.union([citationSchema, z.record(z.string(), citationSchema)]),
    )
    .optional(),
  speakerRanks: z.array(z.array(z.string().min(1))).optional(),
});
export type Ballot = z.infer<typeof ballotRecordSchema>;
/** Written copy retained by screening; only these fields can be released as text. */
export const ballotWrittenRecordSchema = ballotRecordSchema.pick({
  reason: true,
  feedback: true,
});
export type BallotWrittenRecord = z.infer<typeof ballotWrittenRecordSchema>;
/** A trusted screening producer's disposition; held text has no audience copy. */
export const ballotTextScreeningSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ruleSetVersion: z.string().min(1).max(80),
    status: z.literal('held'),
    releasedText: z.null(),
  }),
  z.strictObject({
    ruleSetVersion: z.string().min(1).max(80),
    status: z.literal('clear'),
    releasedText: ballotWrittenRecordSchema,
  }),
]);
export type BallotTextScreening = z.infer<typeof ballotTextScreeningSchema>;

/** The portable competitive fields, validated against their pinned definition before use. */
export const ballotCompetitionRecordSchema = ballotRecordSchema.omit({
  reason: true,
  feedback: true,
  citations: true,
});
export type BallotCompetition = z.infer<typeof ballotCompetitionRecordSchema>;
/** Scores as any ballot carries them: a number or a criteria grid per subject. */
export const ballotScoresRecordSchema = z.record(
  z.string(),
  ballotScoreValueSchema,
);

/**
 * Who a Round's ballots are about: its sides, its competitors' round
 * participant ids in seat order, and its segment keys.
 */
export const ballotSubjectsFor = (
  rules: {
    readonly sides: readonly { readonly key: string }[];
    readonly segments: readonly { readonly key: string }[];
  },
  participants: readonly { readonly id: string; readonly seat: SeatRef }[],
): BallotSubjects => ({
  sides: sideKeysOf(rules),
  speakers: participants
    .filter((participant) => isDebatingSeat(participant.seat))
    .sort((a, b) => seatOrder(rules.sides)(a.seat, b.seat))
    .map((participant) => participant.id),
  segments: rules.segments.map((segment) => segment.key),
});

/** True when the named winner holds fewer points than another side. */
export const isLowPointWin = (
  winner: string,
  scores: Readonly<Record<string, unknown>>,
): boolean => {
  const winnerTotal = pointsTotal(scores[winner] ?? 0);
  return Object.entries(scores).some(
    ([side, score]) => side !== winner && pointsTotal(score) > winnerTotal,
  );
};
