/** Why a club's confirmation did not go through, in words (ADR 0151). */
export const clubConfirmRefusalCopy = {
  invalid_form:
    'Tick the statement, and give your name and your role at the club.',
  none_selected: 'Select the students whose releases the club holds.',
  ineligible:
    'Some selected students can no longer be confirmed. Refresh the page and try again.',
  too_many: 'Too many confirmations in a row. Try again in a few minutes.',
  unavailable: 'That could not be confirmed. Try again.',
} as const;

/** A refusal the route named, in words; anything else is "unavailable". */
export const clubConfirmRefusalOf = (reason: unknown): string =>
  reason === 'invalid_form' ||
  reason === 'none_selected' ||
  reason === 'ineligible'
    ? clubConfirmRefusalCopy[reason]
    : clubConfirmRefusalCopy.unavailable;
