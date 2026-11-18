import { ballotDefinitionIdentity } from '@daisy/protocol';
import { ballotFieldNames } from './ballot';
import type { BallotPlan } from './ballot-plan';

/**
 * A ballot the judge has started but not submitted, kept in this tab only
 * (sessionStorage), so a reload or a dropped connection never costs what
 * they wrote. It ends with the tab and is removed once the ballot is
 * recorded. Only the ballot's own fields are kept, never the command
 * envelope.
 */
export type BallotDraft = Readonly<Record<string, string>>;

export type BallotDraftStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

/** Generous for line-break encoding; a value longer than this is not the judge's. */
const maxValueLength = (plan: BallotPlan) =>
  Math.max(
    64,
    plan.definition.written.reason?.max ?? 0,
    plan.definition.written.feedback?.max ?? 0,
  ) * 2;

/**
 * One draft per judge seat in one Round, on one ballot definition: a draft
 * written on an earlier definition is never read back into the current one.
 */
export const ballotDraftKey = (
  plan: BallotPlan,
  roundId: string,
  participantId: string,
) =>
  `daisy:ballot-draft:${ballotDefinitionIdentity(plan.definition)}:${roundId}:${participantId}`;

/** The ballot's own fields from a form's values; everything else is dropped. */
export function ballotDraftOf(
  plan: BallotPlan,
  values: Readonly<Record<string, string>>,
): BallotDraft {
  const draftFields = new Set(ballotFieldNames(plan));
  const longest = maxValueLength(plan);
  return Object.fromEntries(
    Object.entries(values).filter(
      ([name, value]) => draftFields.has(name) && value.length <= longest,
    ),
  );
}

/** A stored draft's text read back, or null when it is not a draft. */
export function parseBallotDraft(
  plan: BallotPlan,
  raw: string | null,
): BallotDraft | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return null;
    const values = Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    const draft = ballotDraftOf(plan, values);
    return Object.keys(draft).length > 0 ? draft : null;
  } catch {
    return null;
  }
}

/** The stored draft's text, or null when there is none or storage refuses. */
export function storedBallotDraft(
  storage: BallotDraftStorage,
  key: string,
): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps the draft; a full or refused storage keeps nothing and says nothing. */
export function writeBallotDraft(
  plan: BallotPlan,
  storage: BallotDraftStorage,
  key: string,
  values: Readonly<Record<string, string>>,
): void {
  try {
    storage.setItem(key, JSON.stringify(ballotDraftOf(plan, values)));
  } catch {
    // The form still holds what was typed; only the reload copy is lost.
  }
}

export function clearBallotDraft(
  storage: BallotDraftStorage,
  key: string,
): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to remove when storage is refused.
  }
}
