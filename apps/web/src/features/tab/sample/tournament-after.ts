import { linkTo, sampleAction } from '../action';
import { tabRoutes } from '../routes';
import type { TournamentPage } from '../tournament';
import { AUTUMN, LEAGUE_NAME } from './moment';

/** The sample competitor is seed 5: out in the semifinal, to Jensen. */
export const autumnAfter: TournamentPage = {
  kind: 'after',
  name: 'Autumn Open',
  lede: 'Finished 14 Nov · results certified',
  result: {
    eyebrow: 'Your result · Varsity debate',
    title: 'Semifinalist · 3rd of 48',
    detail: `3-1 in prelims · lost the semifinal to Jensen, 2 judges to 1 · 12 points toward the ${LEAGUE_NAME} season`,
    action: linkTo(
      'Bracket and final standings',
      tabRoutes.bracket(AUTUMN),
      true,
    ),
  },
  ballots: {
    rows: [
      {
        title: 'Semifinal · lost 1-2',
        detail: 'v Jensen · three judges',
        action: sampleAction('Read'),
      },
      {
        title: 'Quarterfinal · won 2-1',
        detail: 'v Amari · three judges',
        action: sampleAction('Read'),
      },
    ],
    more: sampleAction('Rounds 1 to 4'),
  },
  recordings: {
    rows: [
      {
        title: 'Semifinal v Jensen',
        detail: '31 minutes',
        action: sampleAction('Watch'),
      },
      {
        title: 'Quarterfinal v Amari',
        detail: '29 minutes',
        action: sampleAction('Watch'),
      },
    ],
    more: sampleAction('Rounds 1 to 4'),
  },
  recordingsNote:
    'Only the people in a round, and their parents or coaches, can watch its recording.',
};
