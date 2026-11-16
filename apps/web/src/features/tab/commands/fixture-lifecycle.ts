/** Where a fixture is in its life: the rows of the plan's state table. */
export type FixtureState =
  | 'draft'
  | 'not_started'
  | 'round_started'
  | 'ballot_in'
  | 'has_result'
  | 'withdrawn';

/** Every fixture reader maps its retained facts onto this same lifecycle. */
export const fixtureState = (
  status: 'draft' | 'published' | 'withdrawn',
  progress: 'not_started' | 'round_started' | 'ballot_in' | 'has_result',
): FixtureState => (status === 'published' ? progress : status);

/** Where a published fixture's Room is, as retained by draw reads. */
export type LiveFixtureState =
  'not_open' | 'open' | 'round_live' | 'ballot_in' | 'has_result';

export const publishedFixtureState = (
  state: LiveFixtureState | null,
): Exclude<FixtureState, 'draft' | 'withdrawn'> => {
  switch (state) {
    case null:
    case 'not_open':
    case 'open':
      return 'not_started';
    case 'round_live':
      return 'round_started';
    case 'ballot_in':
    case 'has_result':
      return state;
  }
};

/** A live Round, a ballot or a result fixes a fixture's pairing. */
export const isRepairable = (state: LiveFixtureState): boolean =>
  publishedFixtureState(state) === 'not_started';
