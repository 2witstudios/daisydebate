import { z } from 'zod';

/**
 * Round analysis: the premium post-round report on one debater seat's
 * performance (DEC-247). It is not a ballot. It never decides the Round,
 * never scores against the ballot rubric, and never reads a ballot. Its
 * skills, limits and version are its own.
 */
export const roundAnalysisVersion = 1;

/** The skills a round analysis scores, 1 to 5 each: the analysis's own dimensions. */
export const roundAnalysisSkills = [
  'refutation',
  'extension',
  'weighing',
  'evidence',
  'crossExamination',
  'structure',
] as const;
export type RoundAnalysisSkill = (typeof roundAnalysisSkills)[number];

export const roundAnalysisLimits = {
  summary: 400,
  item: 280,
  improvements: 3,
  keyMoments: 5,
  missedOpportunities: 5,
  patterns: 3,
  /** Earlier analyses of the same debater read for patterns. */
  history: 5,
} as const;

const text = z.string().trim().min(1).max(roundAnalysisLimits.item);

/** A transcript line by its played position: segment sequence, then line sequence. */
export const roundAnalysisLineSchema = z.strictObject({
  segment: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
});
export type RoundAnalysisLine = z.infer<typeof roundAnalysisLineSchema>;

const skillScore = z.int().min(1).max(5);

export const roundAnalysisSkillsSchema = z.strictObject(
  Object.fromEntries(
    roundAnalysisSkills.map((skill) => [
      skill,
      z.strictObject({ score: skillScore, note: text }),
    ]),
  ) as Record<
    RoundAnalysisSkill,
    z.ZodObject<{ score: typeof skillScore; note: typeof text }>
  >,
);

export const roundAnalysisReportSchema = z.strictObject({
  analysisVersion: z.literal(roundAnalysisVersion),
  summary: z.string().trim().min(1).max(roundAnalysisLimits.summary),
  improvements: z.array(text).min(1).max(roundAnalysisLimits.improvements),
  keyMoments: z
    .array(
      z.strictObject({
        line: roundAnalysisLineSchema,
        happened: text,
        mattered: text,
        strongestReply: text,
      }),
    )
    .max(roundAnalysisLimits.keyMoments),
  missedOpportunities: z
    .array(
      z.strictObject({
        line: roundAnalysisLineSchema,
        argument: text,
        reply: text,
      }),
    )
    .max(roundAnalysisLimits.missedOpportunities),
  skills: roundAnalysisSkillsSchema,
  /** Recurring patterns across this debater's earlier analyses; empty without any. */
  patterns: z.array(text).max(roundAnalysisLimits.patterns),
});
export type RoundAnalysisReport = z.infer<typeof roundAnalysisReportSchema>;

/**
 * A seated debater's round analysis for a completed Round: written, still
 * being written, not available, or locked behind the premium entitlement
 * (DEC-247). Locked carries no content; it lets the page offer the upgrade.
 */
export const roundAnalysisViewSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    report: roundAnalysisReportSchema,
  }),
  z.strictObject({ status: z.literal('pending') }),
  z.strictObject({ status: z.literal('unavailable') }),
  z.strictObject({ status: z.literal('locked') }),
]);
export type RoundAnalysisView = z.infer<typeof roundAnalysisViewSchema>;
