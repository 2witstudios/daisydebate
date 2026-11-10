import { ballotCategories, ballotLimits, debateSides } from '@daisy/protocol';
import { feedbackField, scoreField } from './ballot';

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

const draftFields: ReadonlySet<string> = new Set([
  'winner',
  'reason',
  'low-point',
  ...debateSides.flatMap((side) => [
    feedbackField(side),
    ...ballotCategories.map((category) => scoreField(side, category)),
  ]),
]);

/** Generous for line-break encoding; a value longer than this is not the judge's. */
const maxValueLength = Math.max(ballotLimits.reason, ballotLimits.feedback) * 2;

/** One draft per judge seat in one Round. */
export const ballotDraftKey = (roundId: string, participantId: string) =>
  `daisy:ballot-draft:${roundId}:${participantId}`;

/** The ballot's own fields from a form's values; everything else is dropped. */
export function ballotDraftOf(
  values: Readonly<Record<string, string>>,
): BallotDraft {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([name, value]) =>
        draftFields.has(name) && value.length <= maxValueLength,
    ),
  );
}

/** A stored draft's text read back, or null when it is not a draft. */
export function parseBallotDraft(raw: string | null): BallotDraft | null {
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
    const draft = ballotDraftOf(values);
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
  storage: BallotDraftStorage,
  key: string,
  values: Readonly<Record<string, string>>,
): void {
  try {
    storage.setItem(key, JSON.stringify(ballotDraftOf(values)));
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
