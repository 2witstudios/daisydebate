import type { DayRow, DayView } from '@daisy/protocol/lobby/day-read';
import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';
import type { PostingView } from '@daisy/protocol/lobby/posting-read';
import type { TournamentReads, TournamentView } from '../tournament';
import { AUTUMN, LEAGUE, LEAGUE_NAME, reached, VARSITY } from './moment';
import {
  at,
  dayFixture,
  dayOf,
  dayRow,
  daySlot,
  initials,
  judge,
  lost,
  named,
  over,
  postedFixture,
  postingOf,
  sampleId,
  tabRound,
  versus,
  won,
} from './posting';
import { readBracket } from '../results';
import type { SampleScene } from './scene';
import { sampleStandings } from './standings';
import { autumnFinish, autumnKeepsakes } from './tournament-after';

const DAY = '2026-11-14';
const varsity = { key: VARSITY, name: 'Varsity debate' };
const novice = { key: 'novice-debate', name: 'Novice debate' };
const impromptu = { key: 'impromptu', name: 'Impromptu' };

/** When each moment of the sample day is read. */
export const autumnAsOf = (scene: SampleScene): string =>
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
        ? ({ kind: 'needs_host', count: 2 } as const)
        : ({ kind: 'drafting' } as const);
  return {
    setupUnfinished: reached(scene, 'prelims') ? 0 : 2,
    entryCount: reached(scene, 'prelims') ? 48 : 31,
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

const rolesOf = (scene: SampleScene): TournamentLobbyView['viewerRoles'] => {
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
    signedIn: !visitor,
    viewerRoles: rolesOf(scene),
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
      scene.viewer === 'coach'
        ? { organizationId: sampleId('hartwell'), name: 'Hartwell' }
        : null,
    results: {
      standings: visitor ? reached(scene, 'elims') : reached(scene, 'prelims'),
      bracket: reached(scene, 'elims') ? 'open' : 'not_drawn',
      scoresOpenAt: 'prelims_end',
    },
    host: host ? hostOf(scene) : null,
    capabilities: { enter: !adult, manageEntries: adult },
  };
}

const round = (n: number) => tabRound(AUTUMN, VARSITY, n);

function roundFour(visitor: boolean): PostingView {
  const fixture = (room: number, title: string, judgeName: string) =>
    postedFixture(
      `${AUTUMN}/round-4/room-${room}`,
      `Room ${room}`,
      versus(title),
      [judge(judgeName)],
      !visitor,
    );
  return postingOf(
    AUTUMN,
    varsity,
    round(4),
    {
      opensAt: at(DAY, '15:20'),
      startedAt: visitor ? at(DAY, '15:20') : null,
    },
    12,
    [
      fixture(1, 'Jensen v Amari', 'L. Malik'),
      fixture(2, 'Haddad v Castillo', 'P. Nguyen'),
      // The public sees a competitor under 16 by initials.
      {
        ...fixture(3, 'Okafor v Wu', 'T. Abara'),
        entries: [
          {
            entryId: sampleId('entry/Okafor'),
            shown: visitor ? initials('C. O.') : named('Okafor'),
          },
          { entryId: sampleId('entry/Wu'), shown: named('Wu') },
        ],
      },
      fixture(4, 'Brooks v Petrov', 'E. Fontaine'),
      ...(visitor ? [fixture(5, 'Doyle v Sato', 'R. Keane')] : []),
    ],
    visitor ? 7 : 0,
  );
}

function roundThree(visitor: boolean): PostingView {
  const fixture = (room: number, entrants: string, judgeName: string) =>
    postedFixture(
      `${AUTUMN}/round-3/room-${room}`,
      `Room ${room}`,
      entrants === 'Okafor v Wu' && visitor
        ? [initials('C. O.'), named('Wu')]
        : versus(entrants),
      [judge(judgeName)],
      !visitor,
    );
  return postingOf(
    AUTUMN,
    varsity,
    round(3),
    { opensAt: at(DAY, '13:40'), startedAt: at(DAY, '13:40') },
    24,
    [
      fixture(6, 'Farrow v Okoye', 'M. Reyes'),
      fixture(8, 'Brooks v Petrov', 'S. Cho'),
      fixture(10, 'Reid v Nakata', 'A. Shah'),
      fixture(3, 'Okafor v Wu', 'T. Abara'),
      fixture(1, 'Jensen v Amari', 'L. Malik'),
    ],
    19,
  );
}

const prelim = (n: number) => ({ number: n });
const elim = (n: number, name: string) => ({
  number: n,
  name,
  stage: 'elimination' as const,
});
const slotAt = (time: string, name: string, rows: readonly DayRow[]) =>
  daySlot(AUTUMN, name, at(DAY, time), rows);

/** The sample competitor's day: Doyle, seed 5, out in the semifinal to Jensen. */
function competitorDay(scene: SampleScene): DayView {
  const entry = (wins: number, losses: number): DayRow['entry'] => ({
    entryId: sampleId('entry/Doyle'),
    name: 'Doyle',
    record: { wins, losses },
  });
  const doneRound = (
    n: number,
    opponent: string,
    result: DayRow['result'],
    recorded = false,
  ) =>
    dayRow(AUTUMN, varsity, prelim(n), {
      role: 'competitor',
      entry: entry(2, 1),
      fixture: dayFixture(
        `${AUTUMN}/round-${n}/doyle`,
        `Room ${n + 4}`,
        [
          { name: opponent, side: 'Affirmative' },
          { name: 'Doyle', side: 'Negative', own: true },
        ],
        [judge('R. Keane')],
      ),
      state: over,
      result,
      recording: recorded ? { durationMs: 26 * 60_000 } : null,
    });
  const roundFourRow = dayRow(AUTUMN, varsity, prelim(4), {
    role: 'competitor',
    entry: entry(2, 1),
    fixture: dayFixture(
      'round-4-room-5',
      'Room 5',
      [
        { name: 'Sato', side: 'Affirmative' },
        { name: 'Doyle', side: 'Negative', own: true },
      ],
      [judge('R. Keane')],
    ),
    ...(reached(scene, 'break')
      ? { state: over, result: won() }
      : { state: { kind: 'posted', opensAt: at(DAY, '15:20') } as const }),
  });
  const quarter = dayRow(AUTUMN, varsity, elim(5, 'Quarterfinal'), {
    role: 'competitor',
    entry: entry(3, 1),
    fixture: reached(scene, 'elims')
      ? dayFixture(
          `${AUTUMN}/quarterfinal/doyle`,
          'Room 3',
          [
            { name: 'Amari', side: 'Affirmative' },
            { name: 'Doyle', side: 'Negative', own: true },
          ],
          [judge('L. Malik'), judge('P. Nguyen'), judge('A. Costa')],
        )
      : null,
    ...(reached(scene, 'elims')
      ? { state: over, result: won(2, 1) }
      : { state: { kind: 'not_posted' } as const }),
  });
  const semifinal = dayRow(AUTUMN, varsity, elim(6, 'Semifinal'), {
    role: 'competitor',
    entry: entry(3, 1),
    fixture: dayFixture(
      'semifinal-room-1',
      'Room 1',
      [
        { name: 'Jensen', side: 'Affirmative' },
        { name: 'Doyle', side: 'Negative', own: true },
      ],
      [judge('L. Malik'), judge('P. Nguyen'), judge('A. Costa')],
    ),
    state: { kind: 'posted', opensAt: at(DAY, '17:30') },
  });
  const asOf = autumnAsOf(scene);
  if (reached(scene, 'finished'))
    return dayOf(AUTUMN, asOf, [
      slotAt('10:00', 'Round 1', [doneRound(1, 'Reid', won())]),
      slotAt('11:40', 'Round 2', [doneRound(2, 'Brooks', lost())]),
      slotAt('13:20', 'Round 3', [doneRound(3, 'Farrow', won(), true)]),
      slotAt('15:00', 'Round 4', [roundFourRow]),
      ...autumnKeepsakes.map((row, index) =>
        slotAt(elims[index]?.time ?? '17:00', elims[index]?.slot ?? '', [row]),
      ),
    ]);
  return dayOf(AUTUMN, asOf, [
    slotAt('10:00', 'Round 1', [doneRound(1, 'Reid', won())]),
    slotAt('11:40', 'Round 2', [doneRound(2, 'Brooks', lost())]),
    slotAt('13:20', 'Round 3', [doneRound(3, 'Farrow', won(), true)]),
    slotAt('15:00', 'Round 4', [roundFourRow]),
    slotAt('17:00', 'Quarterfinals', [quarter]),
    ...(reached(scene, 'elims')
      ? [slotAt('17:30', 'Semifinals', [semifinal])]
      : []),
  ]);
}

/** The sample judge, R. Keane: Round 4 alone, then a semifinal panel. */
function judgeDay(scene: SampleScene): DayView {
  const asOf = autumnAsOf(scene);
  const sitting = (
    room: string,
    roomName: string,
    entrants: readonly [string, string],
    judges: readonly string[],
  ) =>
    dayFixture(
      room,
      roomName,
      [
        { name: entrants[0], side: 'Affirmative' },
        { name: entrants[1], side: 'Negative' },
      ],
      judges.map((name) => judge(name)),
    );
  return dayOf(AUTUMN, asOf, [
    slotAt('15:00', 'Round 4', [
      dayRow(AUTUMN, varsity, prelim(4), {
        role: 'judge',
        entry: null,
        fixture: sitting(
          'round-4-room-5',
          'Room 5',
          ['Sato', 'Doyle'],
          ['R. Keane'],
        ),
        state: reached(scene, 'break')
          ? over
          : { kind: 'posted', opensAt: at(DAY, '15:20') },
      }),
    ]),
    ...(reached(scene, 'elims')
      ? [
          slotAt('17:30', 'Semifinals', [
            dayRow(AUTUMN, varsity, elim(6, 'Semifinal'), {
              role: 'judge',
              entry: null,
              fixture: sitting(
                'semifinal-room-1',
                'Room 1',
                ['Jensen', 'Doyle'],
                ['R. Keane', 'P. Nguyen', 'A. Costa'],
              ),
              state: reached(scene, 'finished')
                ? over
                : { kind: 'ballots_due' },
            }),
          ]),
        ]
      : []),
  ]);
}

const ward = (name: string) =>
  ({ kind: 'ward', actorId: sampleId(name), name }) as const;
const schoolEntry = (name: string) =>
  ({ kind: 'school_entry', entryId: sampleId(`entry/${name}`) }) as const;

/** A debate row of someone the viewer answers for. */
const theirRound = (
  person: DayRow['person'],
  name: string,
  record: { readonly wins: number; readonly losses: number },
  round: {
    readonly number: number;
    readonly name?: string;
    readonly stage?: 'elimination';
  },
  opponent: string,
  roomName: string,
  judgeName: string,
  rest: Pick<DayRow, 'state'> & Partial<Pick<DayRow, 'result'>>,
) =>
  dayRow(AUTUMN, varsity, round, {
    person,
    role: 'competitor',
    entry: { entryId: sampleId(`entry/${name}`), name, record },
    fixture: dayFixture(
      `${AUTUMN}/${name}/${round.number}`,
      roomName,
      [
        { name, side: 'Affirmative', own: true },
        { name: opponent, side: 'Negative' },
      ],
      [judge(judgeName)],
    ),
    ...rest,
  });

const speaking = {
  kind: 'live',
  phase: 'speaking',
  speechesBeginAt: null,
} as const;

/** A parent's day: Chidi and Ada's rows, and the parent's own judging. */
function parentDay(scene: SampleScene): DayView {
  const chidi = ward('Chidi');
  const ada = ward('Ada');
  const three = { wins: 3, losses: 1 };
  return dayOf(AUTUMN, autumnAsOf(scene), [
    slotAt('11:40', 'Round 2', [
      dayRow(AUTUMN, impromptu, prelim(2), {
        person: ada,
        role: 'competitor',
        entry: { entryId: sampleId('entry/Ada'), name: 'Ada', record: null },
        fixture: dayFixture(
          `${AUTUMN}/impromptu/2/a`,
          'Section A',
          [{ name: 'Ada', own: true }],
          [judge('S. Cho'), judge('A. Costa')],
          { kind: 'section' },
        ),
        state: over,
        result: {
          kind: 'released',
          decision: { kind: 'ranked', rank: 2, of: 6 },
          scores: null,
        },
      }),
    ]),
    slotAt('13:20', 'Round 3', [
      theirRound(
        chidi,
        'Chidi',
        three,
        prelim(3),
        'Lindqvist',
        'Room 7',
        'S. Cho',
        {
          state: over,
          result: lost(0, 1, 27),
        },
      ),
    ]),
    slotAt('15:00', 'Round 4', [
      theirRound(
        chidi,
        'Chidi',
        three,
        prelim(4),
        'Reid',
        'Room 3',
        'T. Abara',
        {
          state: over,
          result: won(1, 0, 28.5),
        },
      ),
    ]),
    slotAt('17:00', 'Quarterfinals', [
      theirRound(
        chidi,
        'Chidi',
        three,
        elim(5, 'Quarterfinal'),
        'Haddad',
        'Room 4',
        'P. Nguyen',
        { state: speaking },
      ),
    ]),
    slotAt('17:10', 'Novice debate round 4', [
      dayRow(AUTUMN, impromptu, prelim(3), {
        person: ada,
        role: 'competitor',
        entry: { entryId: sampleId('entry/Ada'), name: 'Ada', record: null },
        fixture: dayFixture(
          `${AUTUMN}/impromptu/3/b`,
          'Section B',
          [{ name: 'Ada', own: true }],
          [judge('S. Cho')],
          { kind: 'section' },
        ),
        state: { kind: 'posted', opensAt: at(DAY, '17:10') },
      }),
      dayRow(AUTUMN, novice, prelim(4), {
        role: 'judge',
        entry: null,
        fixture: dayFixture(
          `${AUTUMN}/novice/4/room-9`,
          'Room 9',
          [{ name: 'Ellis' }, { name: 'Farrow' }],
          [judge('You')],
        ),
        state: { kind: 'posted', opensAt: at(DAY, '17:10') },
      }),
    ]),
  ]);
}

/** A coach's day: Hartwell's entries. */
function coachDay(scene: SampleScene): DayView {
  const jensen = schoolEntry('Jensen');
  const haddad = schoolEntry('Haddad');
  return dayOf(AUTUMN, autumnAsOf(scene), [
    slotAt('15:00', 'Round 4', [
      theirRound(
        jensen,
        'Jensen',
        { wins: 4, losses: 0 },
        prelim(4),
        'Amari',
        'Room 1',
        'L. Malik',
        {
          state: over,
          result: won(1, 0, 29),
        },
      ),
      theirRound(
        haddad,
        'Haddad',
        { wins: 3, losses: 1 },
        prelim(4),
        'Castillo',
        'Room 2',
        'P. Nguyen',
        {
          state: over,
          result: won(1, 0, 28),
        },
      ),
    ]),
    slotAt('17:00', 'Quarterfinals', [
      theirRound(
        jensen,
        'Jensen',
        { wins: 4, losses: 0 },
        elim(5, 'Quarterfinal'),
        'Sato',
        'Room 1',
        'L. Malik',
        {
          state: speaking,
        },
      ),
      theirRound(
        haddad,
        'Haddad',
        { wins: 3, losses: 1 },
        elim(5, 'Quarterfinal'),
        'Okafor',
        'Room 4',
        'P. Nguyen',
        {
          state: speaking,
        },
      ),
    ]),
  ]);
}

function dayOfViewer(scene: SampleScene): DayView | null {
  switch (scene.viewer) {
    case 'competitor':
      return competitorDay(scene);
    case 'judge':
      return judgeDay(scene);
    case 'parent':
      return parentDay(scene);
    case 'coach':
      return coachDay(scene);
    case 'host':
    case 'visitor':
      return null;
  }
}

/** Everything Autumn Open's participant page reads for one view. */
export function autumnReads(
  view: TournamentView,
  scene: SampleScene,
): TournamentReads {
  const visitor = scene.viewer === 'visitor';
  return {
    lobby: autumnLobby(scene, scene.viewer === 'host'),
    posting:
      view.kind === 'round' && view.round === '3'
        ? roundThree(visitor)
        : view.kind === 'home' || view.kind === 'round'
          ? roundFour(visitor)
          : null,
    day: dayOfViewer(scene),
    standings:
      view.kind === 'standings'
        ? sampleStandings(AUTUMN, view.event, { ...scene, viewer: 'visitor' })
        : null,
    bracket:
      view.kind === 'bracket' ? readBracket(AUTUMN, view.event, scene) : null,
  };
}
