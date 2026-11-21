import type {
  EntryListView,
  JudgeListView,
  JudgeSlot,
  ListedEntry,
  ListedJudge,
} from '@daisy/protocol/lobby/entry-read';
import { sampleId } from './fixture';
import {
  largeJudge,
  largeSchool,
  largeSchoolCount,
  largeSurname,
  spread,
} from './large-names';

/**
 * Autumn Open's entries and judges at scale: 60 schools, 14 families and 12
 * people who entered alone, and 150 judges. Every group is listed whole.
 * Twenty-three invited entries have not answered, three wait on a guardian,
 * and four schools are short of the judges they owe.
 */
type EntryEvent = ListedEntry['events'][number];
type EntryGroup = EntryListView['groups'][number];
type JudgeGroup = JudgeListView['groups'][number];

const initials = 'ABCDEFGHJKLMNPRSTW';
const personName = (n: number) =>
  `${initials[n % initials.length] ?? 'A'}. ${largeSurname(n)}`;

/** Schools in name order, as the host's list reads them. */
const schoolsByName = (): readonly string[] =>
  Array.from({ length: largeSchoolCount }, (_, k) => largeSchool(k)).sort(
    (a, b) => a.localeCompare(b),
  );

/** The schools that owe more judges than they have named, and by how much. */
const largeShortSchools: ReadonlyMap<string, number> = new Map([
  ['Brook Hill', 1],
  ['Hartwell', 1],
  ['Lakeside', 2],
  ['Pine Ridge', 1],
]);

/** The schools whose invited entries have not answered. */
const unanswered = new Set([
  'Ashford',
  'Bayview',
  'Cedar Park',
  'Eastgate',
  'Elmwood',
  'Glenbrook',
  'Highgate',
  'Kingsley',
  'Marlow',
  'Northfield',
  'Riverside',
]);

const entryOf = (
  n: number,
  events: readonly EntryEvent[],
  facts: Partial<ListedEntry> = {},
): ListedEntry => {
  const name = personName(n);
  return {
    id: sampleId(`entry${name}`),
    name,
    status: n >= 295 && n <= 300 ? 'withdrawn' : 'accepted',
    rating: n % 5 === 4 ? null : 1700 - n,
    events: [...events],
    minor: null,
    invitation: null,
    ...facts,
  };
};

/** Every group of entries, whole: schools by name, then families, then the self-entered. */
export function largeEntryGroups(
  events: readonly EntryEvent[],
  before: boolean,
): readonly EntryGroup[] {
  let n = 0;
  let unansweredLeft = before ? 23 : 0;
  let guardianLeft = before ? 3 : 0;
  const [first = events[0], second = first] = events;
  const eventsOf = (k: number): readonly EntryEvent[] =>
    first === undefined
      ? []
      : k % 9 === 0 && second !== undefined && second !== first
        ? [first, second]
        : [first];
  const schools = schoolsByName().map((school, k): EntryGroup => {
    const size = 4 + spread(k, 3);
    const unansweredHere = unanswered.has(school)
      ? Math.min(unansweredLeft, school === 'Ashford' ? 3 : 2)
      : 0;
    unansweredLeft -= unansweredHere;
    const entries = Array.from({ length: size }, (_, place) => {
      n += 1;
      if (place < unansweredHere)
        return entryOf(n, eventsOf(n), {
          status: 'pending',
          invitation: {
            invitedAt: `2026-11-${String(5 + (n % 7)).padStart(2, '0')}T09:00:00.000Z`,
          },
        });
      return entryOf(n, eventsOf(n));
    });
    const owed = Math.ceil(size / 2);
    return {
      responsible: {
        kind: 'school',
        organizationId: sampleId(`org${school}`),
        name: school,
      },
      entryCount: entries.length,
      makers: [
        {
          userId: sampleId(`maker${personName(400 + k)}`),
          name: personName(400 + k),
        },
      ],
      unknownMakers: 0,
      judgesOwed: owed,
      judgesNamed: owed - (largeShortSchools.get(school) ?? 0),
      entries,
    };
  });
  const families = Array.from({ length: 14 }, (_, k): EntryGroup => {
    const surname = largeSurname(300 + k);
    const entries = Array.from({ length: 1 + (k % 2) }, () => {
      n += 1;
      const waiting = guardianLeft > 0;
      guardianLeft -= waiting ? 1 : 0;
      return entryOf(n, eventsOf(n), {
        status: waiting ? 'pending' : 'accepted',
        minor: {
          age: 14 + (k % 4),
          managedBy: waiting ? null : `${surname} parent`,
        },
      });
    });
    return {
      responsible: {
        kind: 'guardian',
        name: `${surname} family`,
      },
      entryCount: entries.length,
      makers: [
        {
          userId: sampleId(
            `maker${`${initials[k % initials.length] ?? 'A'}. ${surname}`}`,
          ),
          name: `${initials[k % initials.length] ?? 'A'}. ${surname}`,
        },
      ],
      unknownMakers: 0,
      judgesOwed: 1,
      judgesNamed: 1,
      entries,
    };
  });
  const alone = Array.from({ length: 12 }, () => {
    n += 1;
    return entryOf(n, eventsOf(n));
  });
  return [
    ...schools,
    ...families,
    {
      responsible: { kind: 'self' },
      entryCount: alone.length,
      makers: [],
      unknownMakers: 0,
      judgesOwed: 0,
      judgesNamed: 0,
      entries: alone,
    },
  ];
}

/** The ordinary entry list, grown: every group listed, none left unshown. */
export function largeEntryList(
  ordinary: EntryListView,
  events: readonly EntryEvent[],
  before: boolean,
): EntryListView {
  const groups = largeEntryGroups(events, before);
  const entries = groups.flatMap((group) => group.entries);
  const pending = entries.filter((entry) => entry.status === 'pending').length;
  const withdrawn = entries.filter(
    (entry) => entry.status === 'withdrawn',
  ).length;
  return {
    ...ordinary,
    counts: {
      accepted: entries.length - pending - withdrawn,
      withdrawn,
      pending,
      judges: 150,
      rooms: 100,
      judgesNeeded: 100,
    },
    groups: [...groups],
    groupsNotShown: 0,
  };
}

const slotFor = (n: number, slot: number, before: boolean): JudgeSlot => {
  if (before)
    return n % 11 === 0 && slot === 0 ? { state: 'away' } : { state: 'free' };
  if (slot < 3)
    return n % 13 === slot ? { state: 'away' } : { state: 'judged' };
  if (slot === 3)
    return n < 120
      ? { state: 'judging', place: `Room ${n + 1}`, late: n % 37 === 5 }
      : { state: 'free' };
  if (slot === 4) return n < 100 ? { state: 'in_draft' } : { state: 'free' };
  return n % 17 === 3 ? { state: 'away' } : { state: 'free' };
};

const judgeOf = (
  n: number,
  slots: number,
  events: readonly string[],
  before: boolean,
): ListedJudge => {
  const name = largeJudge(n);
  return {
    id: sampleId(`judge${name}`),
    name,
    slots: Array.from({ length: slots }, (_, slot) => slotFor(n, slot, before)),
    clearedFor: n >= 144 ? [] : n % 4 === 0 ? [...events] : events.slice(0, 1),
    judgedCount: before ? 0 : 3 - (n % 13 < 3 ? 1 : 0),
    strikes:
      n % 23 === 7 ? [{ source: 'entry', entryName: largeSurname(n) }] : [],
    declaredConflict:
      n % 47 === 3
        ? { note: `Declared conflict with ${largeSurname(n + 7)}` }
        : null,
  };
};

/** The ordinary judge list, grown to 150 judges in six time slots. */
export function largeJudgeList(
  ordinary: JudgeListView,
  before: boolean,
): JudgeListView {
  const timeSlots = Array.from({ length: 6 }, (_, k) => {
    const name = `Round ${k + 1}`;
    return {
      id: sampleId(`slotlarge${name}`),
      name: `${['08:30', '10:00', '11:30', '13:00', '15:00', '16:30'][k]} · ${name}`,
      judgesNeeded: 120,
    };
  });
  const events = ordinary.events.map((event) => event.id);
  let n = 0;
  const next = () => judgeOf(n++, timeSlots.length, events, before);
  const schools = schoolsByName().map((school, k): JudgeGroup => {
    const named = 2 + (k % 4 === 0 ? 1 : 0);
    const short = largeShortSchools.get(school) ?? 0;
    return {
      responsible: {
        kind: 'school',
        organizationId: sampleId(`org${school}`),
        name: school,
      },
      judgesOwed: named + short,
      judgesNamed: named,
      judges: Array.from({ length: named }, next),
    };
  });
  const families = Array.from({ length: 11 }, (_, k): JudgeGroup => ({
    responsible: { kind: 'guardian', name: `${largeSurname(300 + k)} family` },
    judgesOwed: 1,
    judgesNamed: 1,
    judges: [next()],
  }));
  const unaffiliated: JudgeGroup = {
    responsible: { kind: 'unaffiliated' },
    judgesOwed: 0,
    judgesNamed: 0,
    judges: Array.from({ length: 150 - n }, next),
  };
  const judges = [...schools, ...families, unaffiliated].flatMap(
    (group) => group.judges,
  );
  return {
    ...ordinary,
    timeSlots,
    counts: {
      debaters: largeEntryGroups(ordinary.events, before).flatMap(
        (group) => group.entries,
      ).length,
      judges: judges.length,
    },
    need: before
      ? {
          ...ordinary.need!,
          timeSlotId: timeSlots[0]!.id,
          judgesNeeded: 120,
          judgesCounted: judges.length,
        }
      : {
          ...ordinary.need!,
          tabRoundName: 'Round 6',
          timeSlotId: timeSlots.at(-1)!.id,
          judgesNeeded: 120,
          judgesCounted: judges.filter(
            (judge) => judge.slots.at(-1)?.state === 'free',
          ).length,
        },
    groups: [...schools, ...families, unaffiliated],
    notShown: null,
  };
}
