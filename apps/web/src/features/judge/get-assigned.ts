export type AssignedDebate = {
  readonly id: string;
  readonly title: string;
  /** Where the debate stands, in words. */
  readonly status: string;
  /** The ballot, once it opens. */
  readonly ballotHref: string;
  readonly followHref: string;
};

/**
 * The Judge hub's one data seam: the debates assigned to this judge that
 * still need a ballot. Today it returns one sample debate; the backend read
 * of this judge's seats replaces this function and nothing else.
 */
export const getAssignedDebates = (): readonly AssignedDebate[] => [
  {
    id: 'started',
    title: 'Evening round, under way',
    status: 'The last speech has ended. Your ballot is open.',
    ballotHref: '/judge/ballot/started',
    followHref: '/debates/started?turn=6&kind=person&as=judge',
  },
];
