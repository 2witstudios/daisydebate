/**
 * Where each Train action goes. There is no backend yet, so each is a
 * navigation to the next mock screen, or an explicitly inert control with
 * its reason. The real operations replace these in this file and nowhere
 * else.
 */
export const trainDestinations = {
  hub: '/train',
  welcome: '/train/welcome',
  practice: '/train/practice',
  drill: '/train/drill',
  review: '/train/review',
  customRules: '/train/rules',
  findRanked: '/lobby?mode=ranked',
} as const;

export type InertAction = {
  readonly kind: 'inert';
  /** Why the control does nothing, said to the person who meets it. */
  readonly reason: string;
};

/** Saving a weekly goal needs an account-level training record. */
export const changeGoal: InertAction = {
  kind: 'inert',
  reason: 'Weekly goals can be changed once your training is saved.',
};
