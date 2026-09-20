export type MockActivity = {
  readonly headline: string;
  readonly meta: string;
  readonly actor: string | null;
};

export const activities: readonly MockActivity[] = [
  {
    headline: 'Alex Chen won a ranked debate',
    meta: '+8 rating · 2 hours ago',
    actor: 'Alex Chen',
  },
  {
    headline: 'Priya Shah reached Diamond I',
    meta: '3 hours ago',
    actor: 'Priya Shah',
  },
  {
    headline: 'Marcus Bell uploaded a recording',
    meta: '5 hours ago',
    actor: 'Marcus Bell',
  },
  {
    headline: 'Global Debate Championship registration is now open!',
    meta: '6 hours ago',
    actor: null,
  },
];
