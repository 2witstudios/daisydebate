import { sampleAction } from '../action';
import type {
  HostEntries,
  HostEntryRow,
  HostJudges,
  JudgeSlotState,
  SchoolEntries,
  TournamentJudgeRow,
} from '../entries';
import { tabRoutes } from '../routes';
import { AUTUMN, reached, varsitySwitch, WINTER } from './moment';
import type { SampleScene } from './scene';

const entry = (
  name: string,
  facts: string,
  status: HostEntryRow['status'] = 'accepted',
): HostEntryRow => ({ name, facts, status });

export function sampleHostEntries(
  slug: string,
  scene: SampleScene,
): HostEntries | null {
  if (slug !== AUTUMN) return null;
  const before = !reached(scene, 'prelims');
  return {
    event: varsitySwitch,
    lede: before
      ? '24 debaters accepted, 7 still to answer. 11 judges; 12 rooms need 12.'
      : '48 debaters accepted. 12 judges; 12 rooms need 12.',
    actions: before
      ? [
          sampleAction('Remind the 7'),
          sampleAction('Invite a school or parent', true),
        ]
      : [sampleAction('Invite a school or parent', true)],
    tabs: before ? { debaters: 31, judges: 11 } : { debaters: 48, judges: 12 },
    groups: [
      {
        name: 'Ridgeview',
        enteredBy: 'coach A. Doyle',
        summary: '9 debaters · owes 3 judges, has 3',
        short: false,
        entries: [
          entry('M. Castillo', 'rating 1655'),
          entry('K. Sato', 'rating 1548'),
          before
            ? entry(
                'J. Farrow',
                'no Daisy account yet · invited 3 days ago',
                'not_answered',
              )
            : entry('J. Farrow', 'unrated'),
        ],
        more: sampleAction('6 more from Ridgeview'),
      },
      {
        name: 'Okafor family',
        enteredBy: 'parent N. Okafor',
        summary: '2 debaters · owes 1 judge, has 1',
        short: false,
        entries: [
          entry(
            'C. Okafor',
            'rating 1590 · age 15, account managed by N. Okafor',
          ),
          entry('A. Okafor', 'Impromptu only · age 13'),
        ],
        more: null,
      },
      {
        name: 'Hartwell',
        enteredBy: 'coach P. Lindqvist',
        summary: '7 debaters · owes 3 judges, has 2',
        short: true,
        entries: [entry('R. Jensen', 'rating 1712')],
        more: sampleAction('6 more from Hartwell'),
      },
      {
        name: 'Entered alone',
        enteredBy: null,
        summary: '3 debaters · no judges owed',
        short: false,
        entries: [entry('T. Ellis', 'unrated')],
        more: null,
      },
    ],
    note: '5 more schools. Coaches and parents add and withdraw their own entries; you see every change here.',
  };
}

const labels: Readonly<
  Record<Exclude<JudgeSlotState, 'room' | 'late'>, string>
> = {
  judged: 'judged',
  away: 'away',
  free: 'free',
  in_draft: 'in draft',
};

/** A slot is a state, or a Room the judge is in now (`Room 6 · late`). */
const judge = (
  name: string,
  slots: readonly (Exclude<JudgeSlotState, 'room' | 'late'> | string)[],
  clearedFor: string,
  judged: number,
  neverJudges: string,
  conflict = false,
): TournamentJudgeRow => ({
  name,
  slots: slots.map((slot) =>
    slot in labels
      ? {
          state: slot as JudgeSlotState,
          label: labels[slot as keyof typeof labels],
        }
      : { state: slot.endsWith('late') ? 'late' : 'room', label: slot },
  ),
  clearedFor,
  judged,
  neverJudges,
  conflict,
});

export function sampleHostJudges(
  slug: string,
  scene: SampleScene,
): HostJudges | null {
  if (slug !== AUTUMN) return null;
  const before = !reached(scene, 'prelims');
  return {
    lede: before
      ? 'Round 1 needs 12 judges in Varsity debate and 11 have been named. Hartwell still owes one.'
      : 'Round 4 needs 12 judges in Varsity debate and 11 are free then. Hartwell still owes one.',
    add: sampleAction('Add a judge', true),
    tabs: before ? { debaters: 31, judges: 11 } : { debaters: 48, judges: 12 },
    slots: ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Break'],
    groups: [
      {
        name: 'Ridgeview',
        summary: 'owes 3 judges, has 3',
        remind: null,
        judges: [
          judge(
            'L. Malik',
            ['judged', 'judged', 'judged', 'in_draft', 'free'],
            'Varsity, Novice',
            3,
            "Ridgeview's entries",
          ),
          judge(
            'E. Fontaine',
            ['away', 'judged', 'judged', 'in_draft', 'free'],
            'Varsity',
            2,
            "Ridgeview's entries",
          ),
          judge(
            'A. Shah',
            ['judged', 'judged', 'Room 10', 'free', 'away'],
            'Varsity, Impromptu',
            2,
            "Ridgeview's entries",
          ),
        ],
      },
      {
        name: 'Hartwell',
        summary: 'owes 3 judges, has 2',
        remind: sampleAction('Remind the coach'),
        judges: [
          judge(
            'T. Abara',
            ['judged', 'judged', 'Room 3', 'in_draft', 'free'],
            'Varsity, Novice',
            2,
            "Hartwell's entries",
          ),
          judge(
            'R. Keane',
            ['judged', 'away', 'judged', 'in_draft', 'free'],
            'Varsity',
            2,
            "Hartwell's entries · Wu, who struck him",
          ),
        ],
      },
      {
        name: 'Okafor family',
        summary: 'owes 1 judge, has 1',
        remind: null,
        judges: [
          judge(
            'N. Okafor',
            ['Impromptu', 'Novice', 'Novice', 'free', 'Novice'],
            'Novice, Impromptu',
            3,
            'C. Okafor and A. Okafor are her children. She is never in a room with either, in any event.',
            true,
          ),
        ],
      },
      {
        name: 'Not from a school',
        summary: 'no one owes them',
        remind: null,
        judges: [
          judge(
            'A. Costa',
            ['judged', 'judged', 'judged', 'in_draft', 'free'],
            'All three events',
            3,
            'No one',
          ),
          judge(
            'M. Reyes',
            ['judged', 'judged', 'Room 6 · late', 'free', 'free'],
            'Varsity',
            2,
            'No one',
          ),
        ],
      },
    ],
    more: sampleAction('Show 4 more from Lakeside'),
  };
}

export function sampleSchoolEntries(
  slug: string,
  scene: SampleScene,
): SchoolEntries | null {
  if (scene.viewer !== 'coach' && scene.viewer !== 'parent') return null;
  const edit = sampleAction('Edit');
  if (slug === WINTER && scene.viewer === 'coach')
    return {
      tournament: {
        name: 'Winter Classic',
        href: tabRoutes.tournament(WINTER),
      },
      title: "Hartwell's entries",
      lede: 'Entries close Wed 9 Dec · one debate event, one Speech A and one Speech B each',
      students: [
        {
          name: 'Wu',
          note: 'novice, second season',
          events: 'Parli with Okoye · Impromptu · Extemp',
          problem: null,
          edit,
        },
        {
          name: 'Okoye',
          note: 'novice, first season',
          events: 'Parli with Wu · Oratory',
          problem: null,
          edit,
        },
        {
          name: 'Jensen',
          note: null,
          events: 'Varsity LD · Impromptu',
          problem: null,
          edit,
        },
        {
          name: 'Amari',
          note: 'novice, first season',
          events: 'Novice LD · Impromptu · Oratory',
          problem: 'Impromptu and Oratory run at the same time. Keep one.',
          edit,
        },
        {
          name: 'Reid',
          note: 'third season',
          events: 'Varsity LD',
          problem: null,
          edit,
        },
      ],
      add: sampleAction('Add a student'),
      judges: {
        title: 'You owe 3 judges, and have named 2',
        detail:
          'Two for your four debate entries, one for your six speech entries. One judge can cover both if cleared for both.',
        add: sampleAction('Add'),
      },
      submit: {
        label: 'Submit entries',
        blocked: true,
        note: "Fix Amari's entry to submit. You can add the third judge until Fri 11 Dec.",
      },
    };
  if (slug !== AUTUMN && slug !== WINTER) return null;
  const autumn = slug === AUTUMN;
  const name = autumn ? 'Autumn Open' : 'Winter Classic';
  const parent = scene.viewer === 'parent';
  return {
    tournament: { name, href: tabRoutes.tournament(slug) },
    title: parent ? "Okafor family's entries" : "Hartwell's entries",
    lede: autumn
      ? 'Entries close Thursday 17:00 · one debate event and one speech event each'
      : 'Entries close Wed 9 Dec · one debate event, one Speech A and one Speech B each',
    students: parent
      ? [
          {
            name: 'Chidi',
            note: 'age 15',
            events: autumn ? 'Varsity debate' : 'Varsity LD',
            problem: null,
            edit,
          },
          {
            name: 'Ada',
            note: 'age 13',
            events: 'Impromptu',
            problem: null,
            edit,
          },
        ]
      : [
          {
            name: 'Jensen',
            note: null,
            events: 'Varsity debate',
            problem: null,
            edit,
          },
          {
            name: 'Haddad',
            note: null,
            events: 'Varsity debate',
            problem: null,
            edit,
          },
          {
            name: 'Brooks',
            note: 'second season',
            events: 'Varsity debate · Impromptu',
            problem: null,
            edit,
          },
        ],
    add: sampleAction(parent ? 'Add a child' : 'Add a student'),
    judges: parent
      ? {
          title: 'You owe 1 judge, and have named 1',
          detail:
            'You are cleared for Novice debate and Impromptu, and are never in a room with Chidi or Ada.',
          add: sampleAction('Add'),
        }
      : {
          title: 'You owe 3 judges, and have named 2',
          detail:
            'One for every three debate entries. You can add the third judge until Friday.',
          add: sampleAction('Add'),
        },
    submit: {
      label: 'Submit entries',
      blocked: false,
      note: 'You can change entries until they close.',
    },
  };
}
