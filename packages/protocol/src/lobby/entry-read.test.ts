import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  entryListViewSchema,
  entryReadCatalogue,
  judgeListViewSchema,
  schoolEntriesViewSchema,
} from './entry-read';

setupRitewayBun();

const id = (word: string) => word.padEnd(24, '0');
const varsity = { id: id('varsity'), name: 'Varsity debate', label: 'Varsity' };

const entry = {
  id: id('entry'),
  name: 'M. Castillo',
  status: 'accepted',
  rating: 1655,
  events: [varsity],
  minor: null,
  invitation: null,
};
const entryList = {
  lobbyId: id('lobby'),
  eventId: varsity.id,
  asOf: '2026-11-14T12:00:00.000Z',
  counts: { accepted: 24, pending: 7, judges: 11, rooms: 12, judgesNeeded: 12 },
  groups: [
    {
      responsible: {
        kind: 'school',
        organizationId: id('school'),
        name: 'Ridgeview',
        adultName: 'A. Doyle',
      },
      entryCount: 9,
      judgesOwed: 3,
      judgesNamed: 3,
      entries: [
        entry,
        {
          ...entry,
          id: id('farrow'),
          status: 'pending',
          rating: null,
          invitation: { invitedAt: '2026-11-11T09:00:00.000Z' },
        },
      ],
    },
    {
      responsible: {
        kind: 'guardian',
        name: 'Okafor family',
        adultName: 'N. Okafor',
      },
      entryCount: 1,
      judgesOwed: 1,
      judgesNamed: 1,
      entries: [
        {
          ...entry,
          id: id('okafor'),
          minor: { age: 15, managedBy: 'N. Okafor' },
        },
      ],
    },
    {
      responsible: { kind: 'self' },
      entryCount: 1,
      judgesOwed: 0,
      judgesNamed: 0,
      entries: [],
    },
  ],
  groupsNotShown: 5,
  capabilities: { manageEntries: true },
};

const withEntry = (fields: Record<string, unknown>) => ({
  ...entryList,
  groups: [{ ...entryList.groups[0], entries: [{ ...entry, ...fields }] }],
});

describe('EntryListView', async () => {
  test('a host list of school, family and lone entries', () => {
    assert({
      given: 'entries grouped by who answers for them',
      should: 'parse unchanged',
      actual: parseOutcome(entryListViewSchema, entryList),
      expected: { data: entryList },
    });
  });

  test('contact details are never carried', () => {
    assert({
      given: 'an entry carrying an email address or a phone number',
      should: 'refuse the unknown field',
      actual: [
        parseOutcome(
          entryListViewSchema,
          withEntry({ email: 'a@example.com' }),
        ),
        parseOutcome(entryListViewSchema, withEntry({ phone: '555 0100' })),
      ],
      expected: [
        { issues: ['groups.0.entries.0'] },
        { issues: ['groups.0.entries.0'] },
      ],
    });
  });

  test('a withdrawn entry is not listed', () => {
    assert({
      given: 'a withdrawn entry',
      should: 'refuse its status',
      actual: parseOutcome(
        entryListViewSchema,
        withEntry({ status: 'withdrawn' }),
      ),
      expected: { issues: ['groups.0.entries.0.status'] },
    });
  });
});

const judge = {
  id: id('judge'),
  name: 'R. Keane',
  slots: [
    { state: 'judged' },
    { state: 'judging', place: 'Room 6', late: true },
  ],
  clearedFor: [varsity.id],
  judgedCount: 2,
  strikes: [{ source: 'entry', entryName: 'Wu' }],
  declaredConflict: null,
};
const judgeList = {
  lobbyId: id('lobby'),
  events: [varsity],
  timeSlots: [
    { id: id('slot1'), name: 'Round 1' },
    { id: id('slot2'), name: 'Round 2' },
  ],
  counts: { debaters: 31, judges: 11 },
  need: {
    tabRoundName: 'Round 1',
    eventName: 'Varsity debate',
    judgesNeeded: 12,
    judgesCounted: 11,
    counting: 'named',
  },
  groups: [
    {
      responsible: {
        kind: 'school',
        organizationId: id('school'),
        name: 'Hartwell',
      },
      judgesOwed: 3,
      judgesNamed: 2,
      judges: [judge],
    },
    {
      responsible: { kind: 'unaffiliated' },
      judgesOwed: 0,
      judgesNamed: 0,
      judges: [
        {
          ...judge,
          id: id('okafor'),
          strikes: [],
          declaredConflict: { note: 'Never in a room with her children.' },
        },
      ],
    },
  ],
  notShown: null,
  capabilities: { manageJudges: false },
};

describe('JudgeListView', async () => {
  test('judges with availability by time slot', () => {
    assert({
      given: 'judges by school, with a strike and a declared conflict',
      should: 'parse unchanged',
      actual: parseOutcome(judgeListViewSchema, judgeList),
      expected: { data: judgeList },
    });
  });

  test('one slot per time slot', () => {
    assert({
      given: 'a judge with fewer slots than the time slots',
      should: 'refuse the list',
      actual: parseOutcome(judgeListViewSchema, {
        ...judgeList,
        groups: [{ ...judgeList.groups[0], judges: [{ ...judge, slots: [] }] }],
      }),
      expected: { issues: ['groups'] },
    });
  });

  test('contact details are never carried', () => {
    assert({
      given: 'a judge carrying an email address',
      should: 'refuse the unknown field',
      actual: parseOutcome(judgeListViewSchema, {
        ...judgeList,
        groups: [
          {
            ...judgeList.groups[0],
            judges: [{ ...judge, email: 'k@example.com' }],
          },
        ],
      }),
      expected: { issues: ['groups.0.judges.0'] },
    });
  });
});

const schoolEntries = {
  lobbyId: id('lobby'),
  tournamentName: 'Winter Classic',
  responsible: {
    kind: 'school',
    organizationId: id('school'),
    name: 'Hartwell',
  },
  terms: 'Entries close Wed 9 Dec',
  students: [
    {
      id: id('amari'),
      name: 'Amari',
      note: 'novice, first season',
      entries: [{ id: id('entry'), eventName: 'Impromptu', partnerNames: [] }],
      clash: { eventNames: ['Impromptu', 'Oratory'] },
    },
  ],
  judges: {
    owed: 3,
    named: 2,
    dueAt: '2026-12-11T17:00:00.000Z',
    terms: 'One per three.',
  },
  capabilities: { manageRoster: true, submit: true },
};

describe('SchoolEntriesView', async () => {
  test("a school's and a family's own entries", () => {
    const family = {
      ...schoolEntries,
      responsible: { kind: 'guardian', name: 'Okafor family' },
    };
    assert({
      given: 'a school and a guardian answering for entries',
      should: 'parse each unchanged',
      actual: [
        parseOutcome(schoolEntriesViewSchema, schoolEntries),
        parseOutcome(schoolEntriesViewSchema, family),
      ],
      expected: [{ data: schoolEntries }, { data: family }],
    });
  });

  test('a strict shape', () => {
    assert({
      given: 'a student carrying a contact field',
      should: 'refuse it',
      actual: parseOutcome(schoolEntriesViewSchema, {
        ...schoolEntries,
        students: [{ ...schoolEntries.students[0], phone: '555 0100' }],
      }),
      expected: { issues: ['students.0'] },
    });
  });
});

describe('entryReadCatalogue', async () => {
  test('gates', () => {
    assert({
      given: 'the entry reads',
      should:
        'gate host reads on lobby.host.read and own entries on roster, ballots or guardianship',
      actual: entryReadCatalogue,
      expected: {
        EntryListView: { gate: ['lobby.host.read'] },
        JudgeListView: { gate: ['lobby.host.read'] },
        SchoolEntriesView: {
          gate: [
            'school.roster.manage',
            'school.ballots.read',
            'guardian.link.read',
          ],
        },
      },
    });
  });
});
