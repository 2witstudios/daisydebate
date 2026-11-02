/**
 * Where the round is for this debater. `waiting` is a round whose live
 * position the room cannot read: nobody holds the floor and no phase
 * action is offered.
 */
export type RoundPhase =
  | 'waiting'
  | 'opponent-speaking'
  | 'cross-ex'
  | 'prep'
  | 'own-speech'
  | 'judging';

const tileHeights: Readonly<Record<RoundPhase, number>> = {
  waiting: 120,
  'opponent-speaking': 200,
  'cross-ex': 200,
  prep: 72,
  'own-speech': 120,
  judging: 120,
};

/** The video tiles' height in the phase; the workspace takes the rest. */
export const tileHeightFor = (phase: RoundPhase): number => tileHeights[phase];
