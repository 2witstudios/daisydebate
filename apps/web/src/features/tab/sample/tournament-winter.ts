import type { DayView } from '@daisy/protocol/lobby/day-read';
import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';
import type { TournamentReads, TournamentView } from '../tournament';
import { LEAGUE, LEAGUE_NAME, reached, WINTER } from './moment';
import {
  at,
  dayFixture,
  dayOf,
  dayRow,
  daySlot,
  judge,
  over,
  postedFixture,
  postingOf,
  sampleId,
  tabRound,
  versus,
  won,
} from './posting';
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
    signedIn: scene.viewer !== 'visitor',
    viewerRoles:
      scene.viewer === 'visitor'
        ? []
        : scene.viewer === 'coach' || scene.viewer === 'parent'
          ? ['responsible_adult']
          : [scene.viewer],
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
    results: {
      standings: false,
      bracket: 'closed',
      scoresOpenAt: 'prelims_end',
    },
    host: host
      ? {
          setupUnfinished: 0,
          entryCount: 213,
          slots: running ? hostSlots : [],
          breakState: 'scheduled',
          certified: false,
        }
      : null,
    capabilities: { enter: !adult, manageEntries: adult },
  };
}

/** The sample competitor's day: Parli with Okoye, Impromptu and Extemp. */
function competitorDay(): DayView {
  const slot = (
    time: string,
    name: string,
    rows: Parameters<typeof daySlot>[3],
  ) => daySlot(WINTER, name, at(DAY, time), rows);
  const entry = (one: { readonly key: string }, name: string) => ({
    entryId: sampleId(`entry/${one.key}/${name}`),
    name,
    record: null,
  });
  const team = entry(parli, 'Hartwell B');
  const final = (one: typeof impromptu) =>
    dayRow(
      WINTER,
      one,
      { number: 2, stage: 'elimination' },
      {
        role: 'competitor',
        entry: entry(one, 'Wu'),
        breaking: { size: 6, divisions: [] },
        fixture: null,
        state: { kind: 'not_posted' },
      },
    );
  return dayOf(WINTER, at(DAY, '12:10'), [
    slot('09:00', 'Debate round 1', [
      dayRow(
        WINTER,
        parli,
        { number: 1 },
        {
          role: 'competitor',
          entry: team,
          fixture: dayFixture(
            `${WINTER}/parli/1/hartwell-b`,
            'Room 2',
            [
              { name: 'Hartwell B', side: 'Government', own: true },
              { name: 'Lakeside B', side: 'Opposition' },
            ],
            [judge('L. Malik')],
          ),
          state: over,
          result: won(),
        },
      ),
    ]),
    slot('10:30', 'Speech A round 1', [
      dayRow(
        WINTER,
        impromptu,
        { number: 1 },
        {
          role: 'competitor',
          entry: entry(impromptu, 'Wu'),
          fixture: dayFixture(
            'impromptu-section-c',
            'Section C',
            [{ name: 'Wu', own: true }],
            [judge('S. Cho'), judge('A. Costa')],
            { kind: 'section' },
          ),
          state: over,
          result: { kind: 'withheld', opensAt: 'prelims_end' },
        },
      ),
    ]),
    slot('12:00', 'Debate round 2', [
      dayRow(
        WINTER,
        parli,
        { number: 2 },
        {
          role: 'competitor',
          entry: team,
          fixture: dayFixture(
            `${WINTER}/parli/2/room-7`,
            'Room 7',
            [
              { name: 'Ridgeview C', side: 'Government' },
              { name: 'Hartwell B', side: 'Opposition', own: true },
            ],
            [judge('S. Cho')],
          ),
          state: {
            kind: 'live',
            phase: 'preparing',
            speechesBeginAt: at(DAY, '12:24'),
          },
        },
      ),
    ]),
    slot('13:30', 'Speech B round 1', [
      dayRow(
        WINTER,
        extemp,
        { number: 1 },
        {
          role: 'competitor',
          entry: entry(extemp, 'Wu'),
          fixture: dayFixture(
            `${WINTER}/extemp/1/section-b`,
            'Section B',
            [{ name: 'Wu', own: true }],
            [judge('P. Nguyen')],
            {
              kind: 'section',
              speaks: { position: 2, of: 6 },
              topicAt: at(DAY, '13:00'),
            },
          ),
          state: { kind: 'posted', opensAt: at(DAY, '13:30') },
        },
      ),
    ]),
    slot('15:00', 'Debate round 3', [
      dayRow(
        WINTER,
        parli,
        { number: 3 },
        {
          role: 'competitor',
          entry: team,
          fixture: null,
          state: { kind: 'not_posted' },
        },
      ),
    ]),
    slot('16:30', 'Speech finals', [final(impromptu), final(extemp)]),
    slot('18:00', 'Debate breaks', [
      dayRow(
        WINTER,
        parli,
        { number: 4, stage: 'elimination' },
        {
          role: 'competitor',
          entry: team,
          breaking: { size: null, divisions: ['open', 'novice'] },
          fixture: null,
          state: { kind: 'not_posted' },
        },
      ),
    ]),
  ]);
}

/** Everything Winter Classic's participant page reads for one view. */
export function winterReads(
  view: TournamentView,
  scene: SampleScene,
): TournamentReads {
  return {
    lobby: winterLobby(scene, scene.viewer === 'host'),
    posting:
      view.kind === 'home' || view.kind === 'round'
        ? postingOf(
            WINTER,
            parli,
            tabRound(WINTER, parli.key, 2),
            { opensAt: at(DAY, '12:00'), startedAt: at(DAY, '12:00') },
            19,
            [
              ['Hartwell B v Ridgeview C', 7, 'S. Cho'],
              ['Lakeside A v Ridgeview A', 8, 'A. Costa'],
              ['Hartwell A v Lakeside B', 9, 'L. Malik'],
            ].map(([title, room, judgeName]) =>
              postedFixture(
                `${WINTER}/parli/2/room-${room}`,
                `Room ${room}`,
                versus(String(title)),
                [judge(String(judgeName))],
              ),
            ),
            16,
          )
        : null,
    day: scene.viewer === 'competitor' ? competitorDay() : null,
    standings: null,
    bracket: null,
  };
}
