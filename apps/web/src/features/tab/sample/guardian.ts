import { sampleAction } from '../action';
import type { MinorAccount, TournamentRequest } from '../guardian';
import { tabRoutes } from '../routes';
import { AUTUMN } from './moment';
import type { SampleScene } from './scene';

const family = { label: 'Your family', href: tabRoutes.tournament(AUTUMN) };

/** Only a guardian manages a minor's account. */
export function sampleMinorAccount(
  minor: string,
  scene: SampleScene,
): MinorAccount | null {
  if (minor !== 'ada' || scene.viewer !== 'parent') return null;
  return {
    back: family,
    name: "Ada's account",
    lede: 'Age 13 · you gave consent on 2 Sept 2026',
    lobbiesLegend: 'Lobbies Ada can see and join',
    lobbies: [
      { name: 'Southeast League', detail: null, allowed: true },
      { name: 'Homeschool Forensics Circle', detail: null, allowed: true },
      {
        name: "Daisy's public lobby",
        detail: 'Anyone on Daisy, 13 and over',
        allowed: false,
      },
    ],
    recordings: {
      legend: 'Recordings of Ada',
      options: [
        'Only you, Ada and her judges can watch',
        'Others in the room can watch too',
      ],
      chosen: 0,
    },
    boundary:
      'Ada can see, join, watch and message only inside these lobbies, and in tournaments she is entered in. That holds for search and for links people send her. Her profile is never public. If a coach enters her somewhere outside these lobbies, it waits for you to allow it.',
    save: sampleAction('Save', true),
    withdraw: sampleAction("Withdraw consent and close Ada's account"),
  };
}

export function sampleTournamentRequest(
  minor: string,
  slug: string,
  scene: SampleScene,
): TournamentRequest | null {
  if (minor !== 'ada' || slug !== 'capital-city-classic') return null;
  if (scene.viewer !== 'parent') return null;
  return {
    back: family,
    title: 'Allow Capital City Classic for Ada?',
    lede: 'It is outside the lobbies you allow, so her entry waits for you.',
    facts: [
      {
        title: 'Capital City Classic',
        detail: 'Sat 5 Dec · online · run by Capital Debate League',
      },
      {
        title: 'Entered by Marta Silva',
        detail: 'Her coach at Homeschool Forensics Circle',
      },
      {
        title: 'Impromptu',
        detail: 'Three rounds and a final, in rooms of six with two judges',
      },
      {
        title: 'Recorded for officials',
        detail:
          'Your choice still holds: only you, Ada and her judges can watch',
      },
    ],
    consequence: {
      allows:
        'Ada can see this tournament, join her rooms, watch its rounds and message people in it until it ends.',
      keeps:
        "Capital Debate League's lobby and its other tournaments stay closed to her.",
    },
    allow: sampleAction('Allow this tournament', true),
    decline: sampleAction('Decline'),
    declineNote: 'Declining withdraws the entry and tells her coach.',
  };
}
