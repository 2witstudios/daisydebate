/** A person-menu form's answer. `done` lets the menu close. */
export type PersonActionState = {
  readonly done?: boolean;
  readonly notice?: string;
};

export const personActionNotices = {
  reported: 'Reported.',
  reportFailed: 'Could not send that report. Try again.',
  blocked: 'Blocked.',
  blockFailed: 'Could not block them. Try again.',
} as const;
