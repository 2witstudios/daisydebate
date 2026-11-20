import { largeEntryGroups } from './large-entries';
import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';
import { AUTUMN, LEAGUE, LEAGUE_NAME, reached, VARSITY } from './moment';
import { at, sampleId, tabRound } from './posting';
import { atScale, type SampleScene } from './scene';
import { autumnFinish } from './tournament-after';

const DAY = '2026-11-14';
const varsity = { key: VARSITY, name: 'Varsity debate' };
const novice = { key: 'novice-debate', name: 'Novice debate' };
const impromptu = { key: 'impromptu', name: 'Impromptu' };

/** When each moment of the sample day is read. */
const autumnAsOf = (scene: SampleScene): string =>
  reached(scene, 'finished')
    ? at(DAY, '19:45')
    : reached(scene, 'elims')
      ? at(DAY, '17:24')
      : reached(scene, 'break')
        ? at(DAY, '16:30')
        : reached(scene, 'prelims')
          ? at(DAY, '14:00')
          : at(DAY, '08:00');

const prelimTimes = ['10:00', '11:40', '13:20', '15:00'] as const;
const elims = [
  { slot: 'Quarterfinals', round: 'Quarterfinal', time: '17:00' },
  { slot: 'Semifinals', round: 'Semifinal', time: '17:30' },
  { slot: 'Final', round: 'Final', time: '18:30' },
] as const;

const slotId = (time: string) => sampleId(`${AUTUMN}/slot/${at(DAY, time)}`);

function hostOf(scene: SampleScene): NonNullable<TournamentLobbyView['host']> {
  const finished = reached(scene, 'finished');
  const prelims = (n: number) =>
    reached(scene, 'break') || n <= 2
      ? ({ kind: 'done' } as const)
      : n === 3
        ? ({ kind: 'needs_host', count: atScale(scene) ? 7 : 2 } as const)
        : ({ kind: 'drafting' } as const);
  return {
    setupUnfinished: reached(scene, 'prelims') ? 0 : 2,
    entryCount: atScale(scene)
      ? largeEntryGroups(
          [varsity, impromptu].map((event) => ({
            id: sampleId(event.key),
            name: event.name,
            label: null,
          })),
          !reached(scene, 'prelims'),
        ).reduce((sum, group) => sum + group.entryCount, 0)
      : reached(scene, 'prelims')
        ? 48
        : 31,
    slots: reached(scene, 'prelims')
      ? [
          ...prelimTimes.map((time, index) => ({
            timeSlotId: slotId(time),
            state: prelims(index + 1),
          })),
          ...(reached(scene, 'elims')
            ? [
                {
                  timeSlotId: slotId('17:00'),
                  state: { kind: 'done' } as const,
                },
                {
                  timeSlotId: slotId('17:30'),
                  state: finished
                    ? ({ kind: 'done' } as const)
                    : ({ kind: 'live' } as const),
                },
                {
                  timeSlotId: slotId('18:30'),
                  state: finished
                    ? ({ kind: 'done' } as const)
                    : ({ kind: 'scheduled' } as const),
                },
              ]
            : []),
        ]
      : [],
    breakState: reached(scene, 'elims')
      ? 'announced'
      : reached(scene, 'break')
        ? 'ready'
        : reached(scene, 'prelims')
          ? 'pending'
          : 'scheduled',
    certified: finished,
  };
}

const rolesOf = (scene: SampleScene): SignedInLobby['viewerRoles'] => {
  switch (scene.viewer) {
    case 'host':
      return ['host'];
    case 'coach':
      return ['responsible_adult'];
    case 'parent':
      return ['responsible_adult', 'judge'];
    case 'competitor':
      return ['competitor'];
    case 'judge':
      return ['judge'];
    case 'visitor':
      return [];
  }
};

/** What a tournament lobby read says of the viewer themselves. */
type ViewerKey =
  'signedIn' | 'viewerRoles' | 'viewerEntries' | 'wards' | 'school' | 'host';
type SignedInLobby = Extract<TournamentLobbyView, { readonly signedIn: true }>;
type ViewerPart = TournamentLobbyView extends infer Lobby
  ? Lobby extends TournamentLobbyView
    ? Pick<Lobby, ViewerKey>
    : never
  : never;

/**
 * The viewer's part of a lobby read: a visitor is no one to the lobby, so
 * theirs carries no roles, entries, wards, school or host stop.
 */
export const tournamentViewerOf = (
  scene: SampleScene,
  part: Omit<Pick<SignedInLobby, ViewerKey>, 'signedIn'>,
): ViewerPart =>
  scene.viewer === 'visitor'
    ? {
        signedIn: false,
        viewerRoles: [],
        viewerEntries: [],
        wards: [],
        school: null,
        host: null,
      }
    : { signedIn: true, ...part };

/** Autumn Open as one viewer's lobby read; `host` adds what waits on the host. */
export function autumnLobby(
  scene: SampleScene,
  host: boolean,
): TournamentLobbyView {
  const visitor = scene.viewer === 'visitor';
  const adult = scene.viewer === 'coach' || scene.viewer === 'parent';
  return {
    kind: 'tournament',
    lobbyId: sampleId(AUTUMN),
    handle: AUTUMN,
    name: 'Autumn Open',
    owner: {
      kind: 'organization',
      organizationId: sampleId(LEAGUE),
      organizationKind: 'league',
      name: LEAGUE_NAME,
    },
    asOf: autumnAsOf(scene),
    status: reached(scene, 'finished')
      ? 'completed'
      : reached(scene, 'prelims')
        ? 'running'
        : 'open',
    startsAt: at(DAY, '10:00'),
    place: 'online',
    certifiedAt: reached(scene, 'finished') ? at(DAY, '19:40') : null,
    entry: {
      opensAt: null,
      closesAt: at('2026-11-12', '17:00'),
      capacity: 48,
      taken: 31,
      eligibility: 'organization_added',
      limit: null,
    },
    entered: {
      kind: 'schools',
      schools: [
        { name: 'Ridgeview', entries: 9 },
        { name: 'Hartwell', entries: 7 },
        { name: 'Okafor family', entries: 2 },
      ],
      more: 5,
    },
    terms: [
      {
        title: 'Four rounds, then the top 8',
        detail:
          'Paired by record after a seeded first round. About 40 minutes each.',
      },
      {
        title: 'One-on-one, limited prep',
        detail:
          'You strike from five resolutions in the room, then 20 minutes to prepare.',
      },
      {
        title: 'One judge a room',
        detail: 'Three in elimination rounds and five in the final.',
      },
      {
        title: 'Recorded',
        detail:
          'Rounds are recorded and released to the people in them. Results are public.',
      },
      {
        title: 'Counts for the season',
        detail: `${LEAGUE_NAME} has been asked to count it.`,
      },
    ],
    events: [varsity, novice, impromptu].map((event) => ({
      eventId: sampleId(`${AUTUMN}/${event.key}`),
      name: event.name,
    })),
    timeSlots: [
      ...prelimTimes.map((time, index) => ({
        timeSlotId: slotId(time),
        name: `Round ${index + 1}`,
        startsAt: at(DAY, time),
        tabRounds: [
          {
            ...tabRound(AUTUMN, VARSITY, index + 1),
            // The rounds a participant has a posting for: the one running and the next.
            posting: index + 1 >= 3,
          },
        ],
      })),
      ...elims.map((elim, index) => ({
        timeSlotId: slotId(elim.time),
        name: elim.slot,
        startsAt: at(DAY, elim.time),
        tabRounds: [
          {
            ...tabRound(AUTUMN, VARSITY, 5 + index, elim.round, 'elimination'),
            posting: false,
          },
        ],
      })),
    ],
    break: { at: at(DAY, '16:45'), announced: reached(scene, 'elims') },
    ...tournamentViewerOf(scene, {
      viewerRoles: rolesOf(scene),
      viewerEntries:
        scene.viewer === 'competitor'
          ? [
              {
                entryId: sampleId('entry/Doyle'),
                eventId: sampleId(`${AUTUMN}/${VARSITY}`),
                name: 'Doyle',
                partners: [],
                record: reached(scene, 'break')
                  ? { wins: 3, losses: 1 }
                  : { wins: 2, losses: 1 },
                finish: reached(scene, 'finished') ? autumnFinish : null,
              },
            ]
          : [],
      wards:
        scene.viewer === 'parent'
          ? ['Chidi', 'Ada'].map((name) => ({ actorId: sampleId(name), name }))
          : [],
      school:
        scene.viewer === 'coach' ||
        (atScale(scene) && scene.viewer === 'competitor')
          ? { organizationId: sampleId('hartwell'), name: 'Hartwell' }
          : null,
      host: host ? hostOf(scene) : null,
    }),
    results: {
      standings: visitor ? reached(scene, 'elims') : reached(scene, 'prelims'),
      bracket: reached(scene, 'elims') ? 'open' : 'not_drawn',
      scoresOpenAt: 'prelims_end',
    },
    capabilities: { enter: !adult, manageEntries: adult },
  };
}
