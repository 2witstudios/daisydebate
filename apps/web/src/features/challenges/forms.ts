import {
  done,
  idle,
  refusedWith,
  unreachable,
  type Done,
  type Idle,
  type Moved,
  type Refused,
} from '../forms/form-state';

/** The offer went out, which lets the menu close. */
export type ChallengeSent = { readonly kind: 'sent' };

/**
 * A challenge form's answer. Sending answers `sent`, declining or
 * withdrawing answers `done`, and accepting moves on to the room.
 */
export type ChallengeFormState = Idle | Refused | ChallengeSent | Done | Moved;

export const initialChallengeForm: ChallengeFormState = idle();
export const challengeSent: ChallengeSent = { kind: 'sent' };
export const challengeEnded: Done = done;
export const challengeRefused = (error: string): Refused =>
  refusedWith({}, error);

export const challengeFormUnavailable = (): Refused =>
  challengeRefused('Could not reach Daisy. Try again.');

/**
 * What a challenge form says about its answer: `notice` is everything worth
 * saying, and `refusal` is that same notice only when the answer was a
 * refusal, for a surface that closes on success instead of confirming it.
 */
export type ChallengeFields = {
  readonly notice: string | undefined;
  readonly refusal: string | undefined;
};

const nothingToSay: ChallengeFields = { notice: undefined, refusal: undefined };

export function challengeFields(answer: ChallengeFormState): ChallengeFields {
  switch (answer.kind) {
    case 'refused':
      return { notice: answer.error, refusal: answer.error };
    case 'sent':
      return { notice: 'Challenge sent.', refusal: undefined };
    case 'idle':
    case 'done':
    case 'moved':
      return nothingToSay;
    default:
      return unreachable(answer);
  }
}

/** The refusal for an HTTP status, never naming a block or a status. */
export function challengeRefusal(
  intent:
    | 'send'
    | 'accept'
    | 'accept-ranked'
    | 'accept-placed'
    | 'accept-lost'
    | 'accept-unnamed'
    | 'end',
  status: number,
): string {
  if (intent === 'send') {
    if (status === 404) return 'They cannot take a challenge right now.';
    if (status === 409) return 'Leave your room first.';
    if (status === 422)
      return 'Ranked is not open right now. Send a casual challenge.';
    if (status === 429) return 'You have reached a challenge limit for now.';
    return 'Could not send that challenge. Try again.';
  }
  if (intent === 'accept-placed') return 'Leave your room first.';
  if (intent === 'accept-lost') return 'That challenge is no longer open.';
  if (intent === 'accept-unnamed')
    return 'Could not finish accepting. Try again.';
  if (intent === 'accept-ranked')
    return 'Could not open a ranked room right now. Decline, or ask them for a casual one.';
  if (intent === 'accept') {
    if (status === 404) return 'That challenge is no longer open.';
    return 'Could not open a room for that challenge. Try again.';
  }
  return 'Could not change that challenge. Try again.';
}
