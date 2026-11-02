/** The reasons a spectator can give when reporting. */
export const reportReasons = [
  { id: 'cheat', label: 'Second account or arranged result' },
  { id: 'abuse', label: 'Harassment or hate' },
  { id: 'stall', label: 'Stalling or no-show' },
  { id: 'spam', label: 'Spam' },
  { id: 'other', label: 'Something else' },
] as const;
