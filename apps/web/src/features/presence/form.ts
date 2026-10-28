/** The member's own online-status form: its notice and its refusal. */
export type PresenceFormState = { readonly notice?: string };

/** A failed call says to try again; the choice is two buttons, so nothing is lost. */
export const presenceFormUnavailable = (): PresenceFormState => ({
  notice: 'Could not change your online status. Try again.',
});

/** The confirmation for the member's own online-status choice. */
export const presenceNotice = (hidden: boolean): string =>
  hidden
    ? 'Your friends now see you as offline.'
    : 'Your friends can see when you are online.';
