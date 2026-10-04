/**
 * Controls with no backend behind them. Each answers on the same page with
 * the shell banner and saves nothing; the real operation replaces the entry
 * here and nowhere else.
 */
export const inertActions = {
  remind: {
    label: 'Remind me',
  },
  notifyNew: {
    label: 'Tell me about new events',
  },
  notifyBracket: {
    label: 'Get a message when it posts',
  },
  calendar: {
    label: 'Add to calendar',
  },
  withdraw: {
    label: 'Withdraw',
  },
  withdrawLate: {
    label: 'Withdraw and give a bye',
  },
  leaveWaitlist: {
    label: 'Leave the waitlist',
  },
} as const;

export type InertActionId = keyof typeof inertActions;
