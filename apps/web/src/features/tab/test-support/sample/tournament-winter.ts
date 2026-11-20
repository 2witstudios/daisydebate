import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';
import { LEAGUE, LEAGUE_NAME, reached, WINTER } from './moment';
import { tournamentViewerOf } from './tournament-autumn';
import { at, sampleId, tabRound } from './posting';
import type { SampleScene } from './scene';

const DAY = '2026-12-12';
const event = (key: string, name: string) => ({ key, name });
const varsityLd = event('varsity-ld', 'Varsity LD');
const noviceLd = event('novice-ld', 'Novice LD');
const varsityPf = event('varsity-pf', 'Varsity PF');
const parli = event('parli', 'Parli');
const impromptu = event('impromptu', 'Impromptu');
const oratory = event('oratory', 'Oratory');
const extemp = event('extemp', 'Extemp');
const interp = event('interp', 'Interp');
const debate = [varsityLd, noviceLd, varsityPf, parli];
const speechA = [impromptu, oratory];
const speechB = [extemp, interp];

/** The day's time slots: events in a group run at the same time. */
const slots = [
  { time: '09:00', name: 'Debate round 1', events: debate, number: 1 },
  { time: '10:30', name: 'Speech A round 1', events: speechA, number: 1 },
  { time: '12:00', name: 'Debate round 2', events: debate, number: 2 },
  { time: '13:30', name: 'Speech B round 1', events: speechB, number: 1 },
  { time: '15:00', name: 'Debate round 3', events: debate, number: 3 },
  {
    time: '16:30',
    name: 'Speech finals',
    events: [...speechA, ...speechB],
    number: 2,
  },
  { time: '18:00', name: 'Debate breaks', events: debate, number: 4 },
] as const;

const slotId = (time: string) => sampleId(`${WINTER}/slot/${at(DAY, time)}`);

const hostSlots: NonNullable<TournamentLobbyView['host']>['slots'] = [
  { timeSlotId: slotId('09:00'), state: { kind: 'done' } },
  { timeSlotId: slotId('10:30'), state: { kind: 'done' } },
  { timeSlotId: slotId('12:00'), state: { kind: 'needs_host', count: 3 } },
  { timeSlotId: slotId('13:30'), state: { kind: 'drawn' } },
];

/** Winter Classic as one viewer's lobby read; `host` adds what waits on the host. */
export function winterLobby(
  scene: SampleScene,
  host: boolean,
): TournamentLobbyView {
  const running = reached(scene, 'prelims');
  const adult = scene.viewer === 'coach' || scene.viewer === 'parent';
  return {
    kind: 'tournament',
    lobbyId: sampleId(WINTER),
    handle: WINTER,
    name: 'Winter Classic',
    owner: {
      kind: 'organization',
      organizationId: sampleId(LEAGUE),
      organizationKind: 'league',
      name: LEAGUE_NAME,
    },
    asOf: at(DAY, '12:10'),
    status: running ? 'running' : 'open',
    startsAt: at(DAY, '09:00'),
    place: 'online',
    certifiedAt: null,
    entry: {
      opensAt: running ? null : at('2026-12-01', '09:00'),
      closesAt: at('2026-12-09', '17:00'),
      capacity: null,
      taken: running ? 213 : 0,
      eligibility: 'organization_added',
      limit: 'one debate event, one Speech A and one Speech B each',
    },
    entered: null,
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
    events: [...debate, ...speechA, ...speechB].map((one) => ({
      eventId: sampleId(`${WINTER}/${one.key}`),
      name: one.name,
    })),
    timeSlots: slots.map((slot) => ({
      timeSlotId: slotId(slot.time),
      name: slot.name,
      startsAt: at(DAY, slot.time),
      tabRounds: slot.events.map((one) => ({
        ...tabRound(
          WINTER,
          one.key,
          slot.number,
          null,
          slot.time >= '16:30' ? 'elimination' : 'preliminary',
        ),
        posting: one.key === parli.key && slot.number === 2,
      })),
    })),
    break: null,
    ...tournamentViewerOf(scene, {
      viewerRoles:
        scene.viewer === 'coach' || scene.viewer === 'parent'
          ? ['responsible_adult']
          : scene.viewer === 'visitor'
            ? []
            : [scene.viewer],
      viewerEntries:
        scene.viewer === 'competitor'
          ? [
              { one: parli, name: 'Hartwell B', partners: ['Okoye'] },
              { one: impromptu, name: 'Wu', partners: [] },
              { one: extemp, name: 'Wu', partners: [] },
            ].map(({ one, name, partners }) => ({
              entryId: sampleId(`entry/${one.key}/${name}`),
              eventId: sampleId(`${WINTER}/${one.key}`),
              name,
              partners,
              record: null,
              finish: null,
            }))
          : [],
      wards: [],
      school: null,
      host: host
        ? {
            setupUnfinished: 0,
            entryCount: 213,
            slots: running ? hostSlots : [],
            breakState: 'scheduled',
            certified: false,
          }
        : null,
    }),
    results: {
      standings: false,
      bracket: 'closed',
      scoresOpenAt: 'prelims_end',
    },
    capabilities: { enter: !adult, manageEntries: adult },
  };
}
