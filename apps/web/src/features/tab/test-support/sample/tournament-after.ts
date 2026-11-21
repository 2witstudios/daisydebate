import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';

type Finish = NonNullable<
  TournamentLobbyView['viewerEntries'][number]['finish']
>;

/** The sample competitor is seed 5: out in the semifinal, to Jensen. */
export const autumnFinish: Finish = {
  place: 3,
  of: 48,
  out: {
    tabRoundName: 'Semifinal',
    to: 'Jensen',
    judgesFor: 1,
    judgesAgainst: 2,
  },
  seasonPoints: 12,
};
