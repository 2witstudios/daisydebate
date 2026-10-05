import { bandLabel, rulesLabel, structureLabel } from './labels';
import {
  CHECK_IN_MINUTES,
  FORFEIT_GRACE_MINUTES,
  roundLabels,
} from './schedule';
import type { Tournament } from './tournament';

export type Fact = readonly [label: string, value: string];

/** The "Structure and rules" rows of the overview. */
export function overviewFacts(tournament: Tournament): readonly Fact[] {
  const rounds = roundLabels(tournament.structure, tournament.places).length;
  const open = tournament.band.min === null && tournament.band.max === null;
  return [
    ['Structure', `${structureLabel(tournament.structure)}, ${rounds} rounds`],
    ['Rules', rulesLabel(tournament.rules)],
    ['Places', String(tournament.places)],
    ['Rating', 'Unrated'],
    ['Judging', 'One judge'],
    ['Who can enter', open ? 'Anyone' : `Rated ${bandLabel(tournament.band)}`],
    ['Organizer', tournament.organizer],
  ];
}

export type RuleCard = {
  readonly icon: 'book' | 'gavel' | 'clock' | 'check' | 'bell';
  readonly title: string;
  readonly text: string;
};

/** The cards of the "Rules and judging" tab. */
export function ruleCards(tournament: Tournament): readonly RuleCard[] {
  return [
    tournament.rules === 'standard'
      ? {
          icon: 'book',
          title: 'Standard rules',
          text: 'Same seats, speech length and prep time as Ranked.',
        }
      : {
          icon: 'book',
          title: 'Custom rules',
          text: 'The organizer changed the seats, speech length or prep time.',
        },
    {
      icon: 'gavel',
      title: 'Judges are assigned',
      text: 'Conflicts are checked before each round: same club, recent opponents and any you declare. Judges never see ratings.',
    },
    {
      icon: 'clock',
      title: 'Check-in and forfeits',
      text: `Opens ${CHECK_IN_MINUTES} minutes before each round. A no-show after ${FORFEIT_GRACE_MINUTES} minutes can be forfeited.`,
    },
    {
      icon: 'check',
      title: 'Results and corrections',
      text: 'The judge’s ballot decides. Corrections need a reason and are logged.',
    },
    {
      icon: 'bell',
      title: 'Unrated',
      text: 'Tournament debates never change ratings.',
    },
  ];
}
