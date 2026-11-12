import {
  ballotSchema,
  caseMapSchema,
  type CaseMap,
  judgingBallotFields,
  judgingRecordedIssueLimit,
  type Ballot,
  type JudgingAttemptDiagnostic,
  type JudgingFinish,
  type JudgingIssueCode,
} from '@daisy/protocol';
import type { z } from 'zod';
import { modelJson } from './model-json';

type JudgedAnswer =
  | { readonly ok: true; readonly ballot: Ballot }
  | { readonly ok: false; readonly diagnostic: JudgingAttemptDiagnostic };

type Rejected = {
  readonly ok: false;
  readonly diagnostic: JudgingAttemptDiagnostic;
};
type IssueRecord = JudgingAttemptDiagnostic['issues'][number];
const knownFields: ReadonlySet<string> = new Set(judgingBallotFields);
const knownCodes: ReadonlySet<string> = new Set<JudgingIssueCode>([
  'invalid_type',
  'invalid_value',
  'too_big',
  'too_small',
  'unrecognized_keys',
]);

const fieldOf = (issue: z.core.$ZodIssue): IssueRecord['field'] => {
  if (issue.code === 'unrecognized_keys') return 'unknown_field';
  const path = issue.path.join('.');
  if (path.startsWith('citations')) return 'citations';
  return knownFields.has(path)
    ? (path as IssueRecord['field'])
    : 'unknown_field';
};
const limitOf = (issue: z.core.$ZodIssue): number | undefined => {
  const limit =
    issue.code === 'too_big'
      ? issue.maximum
      : issue.code === 'too_small'
        ? issue.minimum
        : undefined;
  return typeof limit === 'number' ? limit : undefined;
};
/** Built field by field: a Zod message or received value can never pass through. */
const issueRecord = (issue: z.core.$ZodIssue): IssueRecord => {
  const limit = limitOf(issue);
  return {
    field: fieldOf(issue),
    code: knownCodes.has(issue.code)
      ? (issue.code as JudgingIssueCode)
      : 'other',
    ...(limit === undefined ? {} : { limit }),
  };
};

const rejected = (
  category: JudgingAttemptDiagnostic['category'],
  finish: JudgingFinish,
  issues: readonly z.core.$ZodIssue[] = [],
  record: (issue: z.core.$ZodIssue) => IssueRecord = issueRecord,
): Rejected => ({
  ok: false,
  diagnostic: {
    category,
    finish,
    issueCount: issues.length,
    issues: issues.slice(0, judgingRecordedIssueLimit).map(record),
  },
});

type ModelAnswer = {
  readonly text: string;
  readonly finish: JudgingFinish;
  readonly refused: boolean;
};

/**
 * One model answer read as one exact contract, or the safe reason it is
 * not: refused, truncated, malformed or rejected. Nothing is trimmed,
 * defaulted or repaired to make an answer pass.
 */
function contractAnswer<T>(
  answer: ModelAnswer,
  schema: z.ZodType<T>,
  malformed: string,
  record?: (issue: z.core.$ZodIssue) => IssueRecord,
): { readonly ok: true; readonly value: T } | Rejected {
  const { finish } = answer;
  if (answer.refused || finish === 'content_filter')
    return rejected('refused', finish);
  let value: unknown;
  try {
    value = modelJson(answer.text, malformed);
  } catch {
    return rejected(finish === 'length' ? 'truncated' : 'invalid_json', finish);
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return rejected(
    finish === 'length' ? 'truncated' : 'schema_rejected',
    finish,
    result.error.issues,
    record,
  );
}

/**
 * A judge model's answer as the one ballot contract the human judging UI
 * produces (ADR 0058 §6), or the safe reason it is not.
 */
export function judgeAnswer(answer: ModelAnswer): JudgedAnswer {
  const judged = contractAnswer(
    answer,
    ballotSchema,
    'The judge answered malformed JSON',
  );
  return judged.ok ? { ok: true, ballot: judged.value } : judged;
}

type CaseMapAnswer =
  | { readonly ok: true; readonly caseMap: CaseMap }
  | { readonly ok: false; readonly diagnostic: JudgingAttemptDiagnostic };

/**
 * A case-map answer as the case-map contract (ADR 0125), or the safe reason
 * it is not. A rejection names only `case_map`: no path, key or value from
 * the answer is recorded.
 */
export function caseMapAnswer(answer: ModelAnswer): CaseMapAnswer {
  const mapped = contractAnswer(
    answer,
    caseMapSchema,
    'The case map answered malformed JSON',
    (issue) => ({ ...issueRecord(issue), field: 'case_map' }),
  );
  return mapped.ok ? { ok: true, caseMap: mapped.value } : mapped;
}
