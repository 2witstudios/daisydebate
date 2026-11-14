import { linkTo, sampleAction } from '../action';
import { tabRoutes } from '../routes';
import type {
  TournamentPage,
  TournamentTab,
  TournamentView,
} from '../tournament';
import { LEAGUE_NAME, reached, WINTER } from './moment';
import { closed, posting } from './posting';
import type { SampleScene } from './scene';

export function winterPage(
  view: TournamentView,
  scene: SampleScene,
): TournamentPage {
  const adult = scene.viewer === 'coach' || scene.viewer === 'parent';
  if (!reached(scene, 'prelims'))
    return {
      kind: 'before',
      name: 'Winter Classic',
      lede: `Saturday 12 Dec, 09:00 · online · ${LEAGUE_NAME}`,
      places: 'Entries open 1 Dec',
      closes:
        'Entries close Wed 9 Dec · one debate event, one Speech A and one Speech B each',
      enter: adult
        ? linkTo('Manage entries', tabRoutes.entries(WINTER), true)
        : sampleAction('Enter', true),
      terms: [
        {
          title: 'Eight events in three groups',
          detail:
            'Events in a group run at the same time, so you enter one from each.',
        },
        {
          title: 'Debate',
          detail:
            'Varsity LD, Novice LD, Varsity PF and Parli. Three rounds, then breaks at 18:00.',
        },
        {
          title: 'Speech',
          detail:
            'Impromptu, Oratory, Extemp and Interp, in sections of six. Top six to each final.',
        },
        {
          title: 'Counts for the season',
          detail: `The debate events count for ${LEAGUE_NAME}'s season.`,
        },
      ],
      entered: null,
    };
  const day = scene.viewer === 'competitor' && view.kind === 'home';
  const selected = day ? 'day' : view.kind === 'home' ? 'round' : view.kind;
  const tab = (id: string, label: string, href: string): TournamentTab => ({
    id,
    label,
    href,
    selected: id === selected,
  });
  const closedPanel = closed(
    'Results appear here when the break is announced.',
  );
  return {
    kind: 'rounds',
    name: 'Winter Classic',
    lede:
      scene.viewer === 'competitor'
        ? 'Parli with Okoye · Impromptu · Extemp'
        : `${LEAGUE_NAME} · Saturday 12 Dec`,
    headerAction: null,
    yourRoom:
      scene.viewer === 'competitor'
        ? {
            eyebrow: 'Your room · Parli round 2',
            title: 'Opposition v Ridgeview C',
            detail: 'Room 7 · Judge S. Cho · preparing, speeches begin 12:24',
            action: sampleAction('Join', true),
          }
        : null,
    tabs: [
      ...(scene.viewer === 'competitor'
        ? [tab('day', 'Your day', tabRoutes.tournament(WINTER))]
        : []),
      tab('round', 'Rooms', tabRoutes.round(WINTER, 'parli', '2')),
      tab('standings', 'Standings', tabRoutes.standings(WINTER)),
      tab('bracket', 'Brackets', tabRoutes.bracket(WINTER)),
    ],
    panel: day
      ? {
          kind: 'day',
          groups: [
            {
              heading: 'Later today',
              rows: [
                {
                  time: '13:30',
                  title: 'Extemp round 1',
                  detail: 'Section B · 2nd of six · topic at 13:00',
                  href: null,
                },
                {
                  time: '15:00',
                  title: 'Parli round 3',
                  detail: 'Posted when round 2 finishes',
                  href: null,
                },
                {
                  time: '16:30',
                  title: 'Speech finals',
                  detail: 'Top six in Impromptu or Extemp',
                  href: null,
                },
                {
                  time: '18:00',
                  title: 'Parli breaks',
                  detail: 'Eligible for open and novice breaks',
                  href: null,
                },
              ],
            },
            {
              heading: 'Done',
              rows: [
                {
                  time: '10:30',
                  title: 'Impromptu round 1',
                  detail: 'Section C · ranks come after prelims',
                  href: tabRoutes.liveRoom('impromptu-section-c'),
                },
                {
                  time: '09:00',
                  title: 'Parli round 1 · won',
                  detail: 'Government v Lakeside B',
                  href: null,
                },
              ],
            },
          ],
        }
      : view.kind === 'standings' || view.kind === 'bracket'
        ? closedPanel
        : {
            kind: 'posting',
            heading: 'Parli round 2 · started 12:00 · 19 rooms',
            rows: [
              posting('Hartwell B v Ridgeview C', 'Room 7 · Judge S. Cho'),
              posting('Lakeside A v Ridgeview A', 'Room 8 · Judge A. Costa'),
              posting('Hartwell A v Lakeside B', 'Room 9 · Judge L. Malik'),
            ],
            more: 16,
          },
    note: day
      ? 'If a round runs into your next one, stay where you are. Tab can see it and holds your next room.'
      : null,
    noteAction: null,
    signIn: null,
  };
}
