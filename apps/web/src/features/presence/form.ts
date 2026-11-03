import type { ChosenStatus } from '@daisy/protocol';

/** The member's own status form: its notice and its refusal. */
export type PresenceFormState = {
  readonly notice?: string;
  readonly status?: ChosenStatus;
};

/** A failed call says to try again; the choice is three buttons, so nothing is lost. */
export const presenceFormUnavailable = (): PresenceFormState => ({
  notice: 'Could not change your status. Try again.',
});
