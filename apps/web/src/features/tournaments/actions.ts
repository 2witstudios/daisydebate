/**
 * Controls with no backend behind them, by label. A mutating action is never
 * faked: each one renders disabled, and the real operation replaces the entry
 * here and nowhere else.
 */
export const inertActions = {
  remind: 'Remind me',
  notifyNew: 'Tell me about new events',
  notifyBracket: 'Get a message when it posts',
  calendar: 'Add to calendar',
  withdraw: 'Withdraw',
  withdrawLate: 'Withdraw and give a bye',
  leaveWaitlist: 'Leave the waitlist',
} as const;

export type InertActionId = keyof typeof inertActions;
