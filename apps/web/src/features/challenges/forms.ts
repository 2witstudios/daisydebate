/** A challenge form's answer: a notice, or where to go next. */
export type ChallengeFormState = {
  readonly notice?: string;
  readonly next?: string;
  /** Set once sent, so the menu can close and say so. */
  readonly sent?: boolean;
};

export const challengeFormUnavailable = (): ChallengeFormState => ({
  notice: 'Could not reach Daisy. Try again.',
});

/** The refusal for an HTTP status, never naming a block or a status. */
export function challengeRefusal(
  intent: 'send' | 'accept' | 'end',
  status: number,
): string {
  if (intent === 'send') {
    if (status === 409 || status === 404)
      return 'They cannot take a challenge right now.';
    if (status === 429) return 'You have reached a challenge limit for now.';
    return 'Could not send that challenge. Try again.';
  }
  if (intent === 'accept') {
    if (status === 404) return 'That challenge is no longer open.';
    return 'Could not open a room for that challenge. Try again.';
  }
  return 'Could not change that challenge. Try again.';
}
