/**
 * Controls with no backend behind them. A mutating action is never faked:
 * each one renders disabled with its reason, and the real operation replaces
 * the entry here and nowhere else.
 */
export const inertActions = {
  remind: {
    label: 'Remind me',
    reason: 'Reminders arrive with notifications.',
  },
  notifyNew: {
    label: 'Tell me about new events',
    reason: 'Notifications are not available yet.',
  },
  notifyBracket: {
    label: 'Get a message when it posts',
    reason: 'Notifications are not available yet.',
  },
  calendar: {
    label: 'Add to calendar',
    reason: 'Calendar files are not available yet.',
  },
  withdraw: {
    label: 'Withdraw',
    reason: 'Withdrawing needs the registration service.',
  },
  withdrawLate: {
    label: 'Withdraw and give a bye',
    reason: 'Withdrawing needs the registration service.',
  },
  leaveWaitlist: {
    label: 'Leave the waitlist',
    reason: 'Leaving the waitlist needs the registration service.',
  },
} as const;

export type InertActionId = keyof typeof inertActions;
