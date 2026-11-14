import type {
  EntryListView,
  JudgeListView,
  JudgeSlot,
  ListedEntry,
  ListedJudge,
  SchoolEntriesView,
  SchoolStudent,
} from '@daisy/protocol/lobby/entry-read';
import { AUTUMN, reached, WINTER } from './moment';
import type { SampleScene } from './scene';

/** A sample record's id: its name, as a 24-character cuid2-shaped id. */
const sampleId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

const autumnId = sampleId('autumnopen');
const varsity = {
  id: sampleId('eventvarsity'),
  name: 'Varsity debate',
  label: 'Varsity',
};
const impromptu = {
  id: sampleId('eventimpromptu'),
  name: 'Impromptu',
  label: null,
};
const novice = {
  id: sampleId('eventnovice'),
  name: 'Novice debate',
  label: 'Novice',
};

const entry = (
  name: string,
  facts: Partial<ListedEntry> = {},
): ListedEntry => ({
  id: sampleId(`entry${name}`),
  name,
  status: 'accepted',
  rating: null,
  events: [varsity],
  minor: null,
  invitation: null,
  ...facts,
});

const ridgeview = sampleId('orgridgeview');
const hartwell = sampleId('orghartwell');

export function sampleEntryList(
  slug: string,
  scene: SampleScene,
): EntryListView | null {
  if (slug !== AUTUMN) return null;
  const before = !reached(scene, 'prelims');
  return {
    lobbyId: autumnId,
    eventId: varsity.id,
    asOf: '2026-11-14T12:00:00.000Z',
    counts: before
      ? { accepted: 24, pending: 7, judges: 11, rooms: 12, judgesNeeded: 12 }
      : { accepted: 48, pending: 0, judges: 12, rooms: 12, judgesNeeded: 12 },
    groups: [
      {
        responsible: {
          kind: 'school',
          organizationId: ridgeview,
          name: 'Ridgeview',
          adultName: 'A. Doyle',
        },
        entryCount: 9,
        judgesOwed: 3,
        judgesNamed: 3,
        entries: [
          entry('M. Castillo', { rating: 1655 }),
          entry('K. Sato', { rating: 1548 }),
          before
            ? entry('J. Farrow', {
                status: 'pending',
                invitation: { invitedAt: '2026-11-11T09:00:00.000Z' },
              })
            : entry('J. Farrow'),
        ],
      },
      {
        responsible: {
          kind: 'guardian',
          name: 'Okafor family',
          adultName: 'N. Okafor',
        },
        entryCount: 2,
        judgesOwed: 1,
        judgesNamed: 1,
        entries: [
          entry('C. Okafor', {
            rating: 1590,
            minor: { age: 15, managedBy: 'N. Okafor' },
          }),
          entry('A. Okafor', {
            events: [impromptu],
            minor: { age: 13, managedBy: null },
          }),
        ],
      },
      {
        responsible: {
          kind: 'school',
          organizationId: hartwell,
          name: 'Hartwell',
          adultName: 'P. Lindqvist',
        },
        entryCount: 7,
        judgesOwed: 3,
        judgesNamed: 2,
        entries: [entry('R. Jensen', { rating: 1712 })],
      },
      {
        responsible: { kind: 'self' },
        entryCount: 3,
        judgesOwed: 0,
        judgesNamed: 0,
        entries: [entry('T. Ellis')],
      },
    ],
    groupsNotShown: 5,
    capabilities: { manageEntries: true },
  };
}

/** A slot is a state, or a Room the judge is in now (`Room 6 · late`). */
const slot = (cell: string): JudgeSlot => {
  switch (cell) {
    case 'judged':
    case 'away':
    case 'free':
    case 'in_draft':
      return { state: cell };
    default:
      return cell.endsWith(' · late')
        ? {
            state: 'judging',
            place: cell.slice(0, -' · late'.length),
            late: true,
          }
        : { state: 'judging', place: cell, late: false };
  }
};

const judge = (
  name: string,
  slots: readonly string[],
  clearedFor: readonly { readonly id: string }[],
  judgedCount: number,
  facts: Partial<ListedJudge> = {},
): ListedJudge => ({
  id: sampleId(`judge${name}`),
  name,
  slots: slots.map(slot),
  clearedFor: clearedFor.map((event) => event.id),
  judgedCount,
  strikes: [],
  declaredConflict: null,
  ...facts,
});

export function sampleJudgeList(
  slug: string,
  scene: SampleScene,
): JudgeListView | null {
  if (slug !== AUTUMN) return null;
  const before = !reached(scene, 'prelims');
  return {
    lobbyId: autumnId,
    events: [varsity, impromptu, novice],
    timeSlots: ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Break'].map(
      (name) => ({ id: sampleId(`slot${name}`), name }),
    ),
    counts: before
      ? { debaters: 31, judges: 11 }
      : { debaters: 48, judges: 12 },
    need: {
      tabRoundName: before ? 'Round 1' : 'Round 4',
      eventName: varsity.name,
      judgesNeeded: 12,
      judgesCounted: 11,
      counting: before ? 'named' : 'free',
    },
    groups: [
      {
        responsible: {
          kind: 'school',
          organizationId: ridgeview,
          name: 'Ridgeview',
        },
        judgesOwed: 3,
        judgesNamed: 3,
        judges: [
          judge(
            'L. Malik',
            ['judged', 'judged', 'judged', 'in_draft', 'free'],
            [varsity, novice],
            3,
          ),
          judge(
            'E. Fontaine',
            ['away', 'judged', 'judged', 'in_draft', 'free'],
            [varsity],
            2,
          ),
          judge(
            'A. Shah',
            ['judged', 'judged', 'Room 10', 'free', 'away'],
            [varsity, impromptu],
            2,
          ),
        ],
      },
      {
        responsible: {
          kind: 'school',
          organizationId: hartwell,
          name: 'Hartwell',
        },
        judgesOwed: 3,
        judgesNamed: 2,
        judges: [
          judge(
            'T. Abara',
            ['judged', 'judged', 'Room 3', 'in_draft', 'free'],
            [varsity, novice],
            2,
          ),
          judge(
            'R. Keane',
            ['judged', 'away', 'judged', 'in_draft', 'free'],
            [varsity],
            2,
            {
              strikes: [{ source: 'entry', entryName: 'Wu' }],
            },
          ),
        ],
      },
      {
        responsible: { kind: 'guardian', name: 'Okafor family' },
        judgesOwed: 1,
        judgesNamed: 1,
        judges: [
          judge(
            'N. Okafor',
            ['Impromptu', 'Novice', 'Novice', 'free', 'Novice'],
            [novice, impromptu],
            3,
            {
              declaredConflict: {
                note: 'C. Okafor and A. Okafor are her children. She is never in a room with either, in any event.',
              },
            },
          ),
        ],
      },
      {
        responsible: { kind: 'unaffiliated' },
        judgesOwed: 0,
        judgesNamed: 0,
        judges: [
          judge(
            'A. Costa',
            ['judged', 'judged', 'judged', 'in_draft', 'free'],
            [varsity, impromptu, novice],
            3,
          ),
          judge(
            'M. Reyes',
            ['judged', 'judged', 'Room 6 · late', 'free', 'free'],
            [varsity],
            2,
          ),
        ],
      },
    ],
    notShown: { schoolName: 'Lakeside', count: 4 },
    capabilities: { manageJudges: true },
  };
}

const student = (
  name: string,
  note: string | null,
  events: readonly (string | readonly [string, string])[],
  clash: readonly [string, string] | null = null,
): SchoolStudent => ({
  id: sampleId(`student${name}`),
  name,
  note,
  entries: events.map((event) => {
    const [eventName, partner] =
      typeof event === 'string' ? [event, null] : event;
    return {
      id: sampleId(`entry${name}${eventName}`),
      eventName,
      partnerNames: partner === null ? [] : [partner],
    };
  }),
  clash: clash === null ? null : { eventNames: [clash[0], clash[1]] },
});

const capabilities = { manageRoster: true, submit: true };

export function sampleSchoolEntries(
  slug: string,
  scene: SampleScene,
): SchoolEntriesView | null {
  if (scene.viewer !== 'coach' && scene.viewer !== 'parent') return null;
  if (slug === WINTER && scene.viewer === 'coach')
    return {
      lobbyId: sampleId('winterclassic'),
      tournamentName: 'Winter Classic',
      responsible: {
        kind: 'school',
        organizationId: hartwell,
        name: 'Hartwell',
      },
      terms:
        'Entries close Wed 9 Dec · one debate event, one Speech A and one Speech B each',
      students: [
        student('Wu', 'novice, second season', [
          ['Parli', 'Okoye'],
          'Impromptu',
          'Extemp',
        ]),
        student('Okoye', 'novice, first season', [['Parli', 'Wu'], 'Oratory']),
        student('Jensen', null, ['Varsity LD', 'Impromptu']),
        student(
          'Amari',
          'novice, first season',
          ['Novice LD', 'Impromptu', 'Oratory'],
          ['Impromptu', 'Oratory'],
        ),
        student('Reid', 'third season', ['Varsity LD']),
      ],
      judges: {
        owed: 3,
        named: 2,
        dueAt: '2026-12-11T17:00:00.000Z',
        terms:
          'Two for your four debate entries, one for your six speech entries. One judge can cover both if cleared for both.',
      },
      capabilities,
    };
  if (slug !== AUTUMN && slug !== WINTER) return null;
  const autumn = slug === AUTUMN;
  const parent = scene.viewer === 'parent';
  return {
    lobbyId: sampleId(autumn ? 'autumnopen' : 'winterclassic'),
    tournamentName: autumn ? 'Autumn Open' : 'Winter Classic',
    responsible: parent
      ? { kind: 'guardian', name: 'Okafor family' }
      : { kind: 'school', organizationId: hartwell, name: 'Hartwell' },
    terms: autumn
      ? 'Entries close Thursday 17:00 · one debate event and one speech event each'
      : 'Entries close Wed 9 Dec · one debate event, one Speech A and one Speech B each',
    students: parent
      ? [
          student('Chidi', 'age 15', [
            autumn ? 'Varsity debate' : 'Varsity LD',
          ]),
          student('Ada', 'age 13', ['Impromptu']),
        ]
      : [
          student('Jensen', null, ['Varsity debate']),
          student('Haddad', null, ['Varsity debate']),
          student('Brooks', 'second season', ['Varsity debate', 'Impromptu']),
        ],
    judges: parent
      ? {
          owed: 1,
          named: 1,
          dueAt: null,
          terms:
            'You are cleared for Novice debate and Impromptu, and are never in a room with Chidi or Ada.',
        }
      : {
          owed: 3,
          named: 2,
          dueAt: null,
          terms:
            'One for every three debate entries. You can add the third judge until Friday.',
        },
    capabilities,
  };
}
