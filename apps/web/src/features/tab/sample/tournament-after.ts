import type { DayRow } from '@daisy/protocol/lobby/day-read';
import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';
import { AUTUMN, VARSITY } from './moment';
import {
  dayFixture,
  dayRow,
  judge,
  lost,
  over,
  sampleId,
  won,
} from './posting';

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

const varsity = { key: VARSITY, name: 'Varsity debate' };
const three = [judge('L. Malik'), judge('P. Nguyen'), judge('A. Costa')];

const keepsake = (
  number: number,
  name: string,
  opponent: string,
  result: DayRow['result'],
  minutes: number,
): DayRow =>
  dayRow(
    AUTUMN,
    varsity,
    { number, name, stage: 'elimination' },
    {
      role: 'competitor',
      entry: {
        entryId: sampleId('entry/Doyle'),
        name: 'Doyle',
        record: { wins: 3, losses: 1 },
      },
      fixture: dayFixture(
        `${AUTUMN}/${name.toLowerCase()}/doyle`,
        `Room ${number - 4}`,
        [
          { name: opponent, side: 'Affirmative' },
          { name: 'Doyle', side: 'Negative', own: true },
        ],
        three,
      ),
      state: over,
      result,
      // Recorded and released to the people in the round.
      recording: { durationMs: minutes * 60_000 },
    },
  );

/** What a finished Autumn Open keeps for its competitor: the elimination rounds. */
export const autumnKeepsakes: readonly DayRow[] = [
  keepsake(5, 'Quarterfinal', 'Amari', won(2, 1), 29),
  keepsake(6, 'Semifinal', 'Jensen', lost(1, 2), 31),
];
