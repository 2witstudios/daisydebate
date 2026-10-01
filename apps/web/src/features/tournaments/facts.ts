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
  const places =
    tournament.structure === 'single-elimination'
      ? `${tournament.places} (top seeds get byes if fewer enter)`
      : String(tournament.places);
  const open = tournament.band.min === null && tournament.band.max === null;
  return [
    ['Structure', `${structureLabel(tournament.structure)}, ${rounds} rounds`],
    ['Rules', rulesLabel(tournament.rules)],
    ['Places', places],
    ['Rating', 'Unrated tournament'],
    ['Judging', 'One judge, assigned by Daisy'],
    [
      'Who can enter',
      open
        ? 'Any debater with a username and a rating'
        : `Debaters rated ${bandLabel(tournament.band)}`,
    ],
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
          text: 'Every debate runs Daisy’s standard rules: seats, speech length and prep time, exactly as in Ranked. This tournament adds no custom rules.',
        }
      : {
          icon: 'book',
          title: 'Custom rules',
          text: 'The organizer changed the seats, speech length or prep time. The changes are shown to every entrant before they register.',
        },
    {
      icon: 'gavel',
      title: 'Judges are assigned by Daisy',
      text: 'Organizers and entrants do not pick judges. Before each round, conflicts are checked: same club, recent debates with the same entrant, and any conflict you declared. Ratings stay hidden while a judge decides.',
    },
    {
      icon: 'clock',
      title: 'Check-in and forfeits',
      text: `Check-in opens ${CHECK_IN_MINUTES} minutes before each round. If a debater has not checked in ${FORFEIT_GRACE_MINUTES} minutes after the start time, the organizer can record a forfeit.`,
    },
    {
      icon: 'check',
      title: 'Results and corrections',
      text: 'The judge’s ballot decides the result. An organizer can correct a result only with a reason, and every correction is shown in the tournament log.',
    },
    {
      icon: 'bell',
      title: 'Unrated',
      text: 'Tournament debates never change ratings. Your ladder standing comes from Ranked play.',
    },
  ];
}
