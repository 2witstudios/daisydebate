import { mapTabCommandAnswer } from './command-form-answer';

const refusalWords: Readonly<Record<string, string>> = {
  'version-conflict': 'People changed. Reload this page before trying again.',
  'already-granted': 'That person already holds this role here.',
  'not-a-member': 'Choose an active member of this organization.',
  'expiry-passed': 'Choose an expiry in the future.',
  'role-not-below': 'Choose a role below your own.',
  'permission-not-held':
    'You cannot give a role with permissions you do not hold.',
  'scope-not-covered': 'You cannot give that role at this scope.',
  'age-band': 'That person does not meet this role’s staff age requirement.',
  'grant-ended': 'That role has already ended. Reload this page.',
  'command-conflict':
    'This action conflicts with an earlier request. Reload this page.',
};
/** One human-readable interpretation of the existing grant command answer. */
export const peopleCommandResult = (
  intent: 'give' | 'remove' | 'cancel',
  body: unknown,
) => {
  return mapTabCommandAnswer(body, {
    accepted: () => ({
      kind: 'changed' as const,
      notice:
        intent === 'give'
          ? 'Role given.'
          : intent === 'cancel'
            ? 'Invitation cancelled.'
            : 'Role ended.',
    }),
    refused: (reason) => ({
      kind: 'refused' as const,
      error:
        refusalWords[reason] ??
        'This change could not be made. Reload this page.',
    }),
    unacknowledged: () => ({ kind: 'unacknowledged' as const }),
    pending: {
      contract: 'people',
      answer: () => ({
        kind: 'refused' as const,
        error: 'This change is waiting for confirmation.',
      }),
    },
  });
};
