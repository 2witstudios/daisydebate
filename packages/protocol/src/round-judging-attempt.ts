import { z } from 'zod';
import { ballotCategories } from './ballot';

const sides = ['affirmative', 'negative'] as const;
const UNKNOWN_FIELD = 'unknown_field';

/**
 * Every ballot field a rejection may name. A path outside this list becomes
 * the unknown marker, so a model-chosen key can never reach storage or telemetry.
 */
export const judgingBallotFields = [
  'rubricVersion',
  'winner',
  'reason',
  'citations',
  'scores',
  'feedback',
  ...sides.flatMap((side) => [
    `scores.${side}`,
    `feedback.${side}`,
    ...ballotCategories.map((category) => `scores.${side}.${category}`),
  ]),
  UNKNOWN_FIELD,
] as const;

const judgingIssueCodes = [
  'invalid_type',
  'invalid_value',
  'too_big',
  'too_small',
  'unrecognized_keys',
  'other',
] as const;
export type JudgingIssueCode = (typeof judgingIssueCodes)[number];

/** How a provider's answer ended, reduced to facts that hold no answer text. */
export const judgingFinishes = [
  'stop',
  'length',
  'content_filter',
  'other',
  'none',
] as const;
export type JudgingFinish = (typeof judgingFinishes)[number];

/** Why one attempt produced no ballot. Each has a different meaning and owner. */
export const judgingAttemptCategories = [
  'invalid_json',
  'schema_rejected',
  'truncated',
  'refused',
  'provider_refused',
  'provider_error',
  'timeout',
] as const;
export type JudgingAttemptCategory = (typeof judgingAttemptCategories)[number];

/** Why a judging job ended without a ballot. */
export const judgingTerminalReasons = [
  'attempts_exhausted',
  'ballot_hold_ended',
  'generation_deadline',
  'provider_refused',
  'round_ended',
] as const;
export type JudgingTerminalReason = (typeof judgingTerminalReasons)[number];

const MAX_RECORDED_ISSUES = 16;

/**
 * What a failed attempt may durably say: allowlisted fields, issue codes and
 * contract limits. Never a message, a received value or provider text.
 */
export const judgingAttemptDiagnosticSchema = z.strictObject({
  category: z.enum(judgingAttemptCategories),
  finish: z.enum(judgingFinishes),
  issueCount: z.int().nonnegative(),
  issues: z
    .array(
      z.strictObject({
        field: z.enum(judgingBallotFields),
        code: z.enum(judgingIssueCodes),
        limit: z.int().nonnegative().optional(),
      }),
    )
    .max(MAX_RECORDED_ISSUES),
});
export type JudgingAttemptDiagnostic = z.infer<
  typeof judgingAttemptDiagnosticSchema
>;
export const judgingRecordedIssueLimit = MAX_RECORDED_ISSUES;
