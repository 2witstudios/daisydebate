import { parseUsername } from '@daisy/auth';
import {
  idle,
  type Idle,
  type Moved,
  type Refused,
} from '../../../features/forms/form-state';
import type { ClaimUsername } from './claim-username';

export type UsernameNotice =
  'invalid' | 'taken' | 'signed-out' | 'rate-limited' | 'unavailable';

/** A refused claim: the name as typed (`values.username`), and why. */
export type UsernameRefused = Refused & {
  readonly values: { readonly username: string };
  readonly error: UsernameNotice;
};

/**
 * What the username form's action answers: nothing yet, a refusal, or, once
 * the account has its name, where the page goes next.
 */
export type UsernameFormState = Idle | UsernameRefused | Moved;

export const initialUsernameForm: UsernameFormState = idle();

export const usernameRefused = (
  username: string,
  notice: UsernameNotice,
): UsernameRefused => ({
  kind: 'refused',
  values: { username },
  error: notice,
});

/** What the username form renders: the name to show again and the refusal beside it. */
export type UsernameFields = {
  readonly username: string;
  readonly notice: UsernameNotice | undefined;
};

const blank: UsernameFields = { username: '', notice: undefined };

export function usernameFields(answer: UsernameFormState): UsernameFields {
  switch (answer.kind) {
    case 'idle':
    case 'moved':
      return blank;
    case 'refused':
      return { username: answer.values.username, notice: answer.error };
  }
}

/** How one posted claim ended. Only `claimed` and `already-set` move on. */
export type ClaimSubmission =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'already-set' }
  | { readonly kind: 'refused'; readonly state: UsernameRefused };

/** The local shape check, run in the browser and again on the server. */
export const refusesShape = (username: string): boolean =>
  !parseUsername(username).ok;

const refused = (
  username: string,
  notice: UsernameNotice,
): ClaimSubmission => ({
  kind: 'refused',
  state: usernameRefused(username, notice),
});

const postedUsername = (form: FormData): string => {
  const field = form.get('username');
  return typeof field === 'string' ? field : '';
};

/**
 * One posted username form, claimed through `claim`. The form is untrusted:
 * a missing or non-text field is an empty name, and a malformed name is
 * refused before any claim. A claim that throws is unavailable, never a
 * success.
 */
export async function submitClaim(
  claim: ClaimUsername,
  form: FormData,
): Promise<ClaimSubmission> {
  const username = postedUsername(form);
  if (refusesShape(username)) return refused(username, 'invalid');
  let outcome: Awaited<ReturnType<ClaimUsername>>;
  try {
    outcome = await claim(username);
  } catch {
    return refused(username, 'unavailable');
  }
  if (outcome.kind === 'claimed' || outcome.kind === 'already-set')
    return { kind: outcome.kind };
  return refused(username, outcome.kind);
}

/**
 * A posted form whose claim never reached the server, because the
 * browser's call to the action failed in transport.
 */
export const claimUnavailable = (form: FormData): UsernameRefused =>
  usernameRefused(postedUsername(form), 'unavailable');

/**
 * What the browser adds to the server's answer: its own refusal of a
 * malformed name, or `edited` once the person typed since that answer.
 */
export type LocalNotice = 'invalid' | 'edited' | undefined;

/**
 * The notice the form shows. A pending claim shows none: the server's last
 * answer was about the name before it, and its refusal must not come back
 * for the new name while that one is in flight.
 */
export const shownNotice = ({
  local,
  answered,
  pending,
}: {
  readonly local: LocalNotice;
  readonly answered: UsernameNotice | undefined;
  readonly pending: boolean;
}): UsernameNotice | undefined => {
  if (pending || local === 'edited') return undefined;
  return local ?? answered;
};
