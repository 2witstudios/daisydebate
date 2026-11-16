import type {
  EntryListView,
  JudgeListView,
  JudgeSlot,
  ListedEntry,
  SchoolEntriesView,
} from '@daisy/protocol/lobby/entry-read';
import { sampleAction, type TabAction } from './action';
import { tabRoutes } from './routes';
import type { EventSwitch } from './setup';
import {
  sampleEntryList,
  sampleJudgeList,
  sampleSchoolEntries,
} from './sample/entries';
import { varsitySwitch } from './sample/event-switch';
import type { SampleScene } from './sample/scene';

export type EntryStatus =
  'accepted' | 'not_answered' | 'waiting_guardian' | 'withdrawn';
export const entryStatusLabels: Readonly<Record<EntryStatus, string>> = {
  accepted: 'Accepted',
  not_answered: 'Not answered',
  waiting_guardian: 'Waiting on a guardian',
  withdrawn: 'Withdrawn',
};
const entryStatusOf = (entry: ListedEntry): EntryStatus =>
  entry.status === 'withdrawn'
    ? 'withdrawn'
    : entry.status === 'accepted'
      ? 'accepted'
      : entry.minor !== null &&
          entry.minor.managedBy === null &&
          entry.invitation === null
        ? 'waiting_guardian'
        : 'not_answered';

type HostEntryRow = {
  readonly name: string;
  readonly facts: string;
  readonly status: EntryStatus;
};

/** The entries one responsible adult answers for. */
type EntryGroup = {
  readonly kind: EntryListView['groups'][number]['responsible']['kind'];
  readonly name: string;
  readonly enteredBy: string | null;
  readonly summary: string;
  /** Whether the group still owes judges. */
  readonly short: boolean;
  readonly entries: readonly HostEntryRow[];
  readonly more: TabAction | null;
};

export type EntriesTabs = {
  readonly debaters: number;
  readonly judges: number;
};

export type HostEntries = {
  readonly event: EventSwitch;
  readonly lede: string;
  readonly actions: readonly TabAction[];
  readonly tabs: EntriesTabs;
  readonly groups: readonly EntryGroup[];
  readonly note: string;
};

export type JudgeSlotState =
  'judged' | 'away' | 'free' | 'in_draft' | 'room' | 'late';

type TournamentJudgeRow = {
  readonly name: string;
  /** One cell per time slot, in the columns' order. */
  readonly slots: readonly {
    readonly state: JudgeSlotState;
    readonly label: string;
  }[];
  readonly clearedFor: string;
  readonly cleared: boolean;
  readonly judged: number;
  readonly neverJudges: string;
  /** A conflict that holds in every event, such as a judge's own children. */
  readonly conflict: boolean;
};

type JudgeGroup = {
  readonly name: string;
  readonly summary: string;
  readonly remind: TabAction | null;
  readonly judges: readonly TournamentJudgeRow[];
};

export type HostJudges = {
  readonly lede: string;
  readonly add: TabAction | null;
  readonly tabs: EntriesTabs;
  readonly slots: readonly {
    readonly id: string;
    readonly label: string;
    readonly needed: number | null;
    readonly free: number;
    readonly placed: number;
  }[];
  readonly defaultSlotId: string | null;
  readonly groups: readonly JudgeGroup[];
  readonly more: TabAction | null;
};

type SchoolStudent = {
  readonly name: string;
  readonly note: string | null;
  readonly events: string;
  /** What stops this student's entries being submitted. */
  readonly problem: string | null;
  readonly edit: TabAction;
};

/** A responsible adult's own entries at one tournament. */
export type SchoolEntries = {
  readonly tournament: { readonly name: string; readonly href: string };
  readonly title: string;
  readonly lede: string;
  readonly students: readonly SchoolStudent[];
  readonly add: TabAction;
  readonly judges: {
    readonly title: string;
    readonly detail: string;
    readonly add: TabAction;
  };
  readonly submit: {
    readonly label: string;
    readonly blocked: boolean;
    readonly note: string;
  };
};

const numberWords = ['no', 'one', 'two', 'three', 'four', 'five'] as const;
const inWords = (count: number): string => numberWords[count] ?? String(count);
const ordinals = ['first', 'second', 'third', 'fourth', 'fifth'] as const;
const ordinal = (position: number): string =>
  ordinals[position - 1] ?? `${position}th`;
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const dayMs = 86_400_000;

/** What a host reads about one entrant, most telling first. */
function entryFacts(view: EntryListView, entry: ListedEntry): string {
  if (entry.invitation !== null) {
    const days = Math.floor(
      (Date.parse(view.asOf) - Date.parse(entry.invitation.invitedAt)) / dayMs,
    );
    return `no Daisy account yet · invited ${plural(days, 'day')} ago`;
  }
  const standing = entry.events.some((event) => event.id === view.eventId)
    ? entry.rating === null
      ? 'rating not shown'
      : `rating ${entry.rating}`
    : `${entry.events.map((event) => event.name).join(', ')} only`;
  if (entry.minor === null) return standing;
  const managed =
    entry.minor.managedBy === null
      ? ''
      : `, account managed by ${entry.minor.managedBy}`;
  return `${standing} · ${entry.minor.age === null ? 'minor' : `age ${entry.minor.age}`}${managed}`;
}

const owing = (owed: number, named: number): string =>
  `owes ${plural(owed, 'judge')}, has ${named}`;

/** A host's entries screen, from the read their gate allowed. */
export function hostEntriesOf(
  view: EntryListView,
  event: EventSwitch,
): HostEntries {
  const { accepted, pending, withdrawn, judges, rooms, judgesNeeded } =
    view.counts;
  const manage = view.capabilities.manageEntries;
  return {
    event,
    lede: `${accepted} entries accepted${pending > 0 ? `, ${pending} still to answer` : ''}. ${judges} accepted eligible judges; ${judgesNeeded === null ? 'panel demand is not shown' : `${rooms} rooms need ${judgesNeeded}`}.`,
    actions: manage
      ? [
          ...(pending > 0 ? [sampleAction(`Remind the ${pending}`)] : []),
          sampleAction('Invite a school or parent', true),
        ]
      : [],
    tabs: { debaters: accepted + pending + withdrawn, judges },
    groups: view.groups.map((group) => {
      const { responsible } = group;
      const name =
        responsible.kind === 'self' ? 'Entered alone' : responsible.name;
      const hidden = group.entryCount - group.entries.length;
      return {
        name,
        kind: responsible.kind,
        enteredBy:
          group.makers.length || group.unknownMakers
            ? `Entered by ${group.makers.map((maker) => maker.name).join(', ')}${group.unknownMakers ? `${group.makers.length ? '; ' : ''}${group.unknownMakers} unknown makers` : ''}`
            : null,
        summary: `${group.entryCount} entries · ${group.judgesOwed === null ? 'judge obligations unconfigured' : group.judgesOwed === 0 ? 'no judges owed' : owing(group.judgesOwed, group.judgesNamed)}`,
        short:
          group.judgesOwed !== null && group.judgesNamed < group.judgesOwed,
        entries: group.entries.map((entry) => ({
          name: entry.name,
          facts: entryFacts(view, entry),
          status: entryStatusOf(entry),
        })),
        more:
          hidden > 0 && responsible.kind !== 'self'
            ? sampleAction(`${hidden} more from ${name}`)
            : null,
      };
    }),
    note: `${view.groupsNotShown} more schools. Coaches and parents add and withdraw their own entries; you see every change here.`,
  };
}

const slotLabels: Readonly<
  Record<Exclude<JudgeSlot['state'], 'judging'>, string>
> = {
  judged: 'judged',
  away: 'away',
  free: 'free',
  in_draft: 'in draft',
  waiting_for_start: 'waiting for start',
  awaiting_result: 'awaiting result',
};

const slotOf = (slot: JudgeSlot): TournamentJudgeRow['slots'][number] =>
  slot.state === 'judging'
    ? slot.late
      ? { state: 'late', label: `${slot.place} · late` }
      : { state: 'room', label: slot.place }
    : {
        state:
          slot.state === 'waiting_for_start' || slot.state === 'awaiting_result'
            ? 'room'
            : slot.state,
        label: slotLabels[slot.state],
      };

/** A host's judges screen, from the read their gate allowed. */
export function hostJudgesOf(view: JudgeListView): HostJudges {
  const { need } = view;
  const short = view.groups.flatMap((group) =>
    group.responsible.kind === 'school' &&
    group.judgesOwed !== null &&
    group.judgesNamed < group.judgesOwed
      ? [
          ` ${group.responsible.name} still owes ${inWords(group.judgesOwed - group.judgesNamed)}.`,
        ]
      : [],
  );
  const clearedFor = (ids: readonly string[]) =>
    ids.length === view.events.length
      ? `All ${inWords(ids.length)} events`
      : ids
          .flatMap((id) => view.events.filter((event) => event.id === id))
          .map((event) => event.label ?? event.name)
          .join(', ');
  return {
    lede:
      need === null
        ? `${view.counts.judges} accepted eligible judges. Judge obligations unconfigured.`
        : `${need.tabRoundName} needs ${need.judgesNeeded} judges in ${need.eventName} and ${need.judgesCounted} ${
            need.counting === 'named' ? 'have been named' : 'are free then'
          }.${short.join('')}`,
    add: sampleAction('Add a judge', true),
    tabs: view.counts,
    defaultSlotId: view.need?.timeSlotId ?? view.timeSlots.at(-1)?.id ?? null,
    slots: view.timeSlots.map((slot, index) => ({
      id: slot.id,
      label: slot.name,
      needed: slot.judgesNeeded,
      free: view.groups
        .flatMap((group) => group.judges)
        .filter((judge) => judge.slots[index]?.state === 'free').length,
      placed: view.groups
        .flatMap((group) => group.judges)
        .filter((judge) =>
          ['judging', 'in_draft', 'judged'].includes(
            judge.slots[index]?.state ?? '',
          ),
        ).length,
    })),
    groups: view.groups.map((group) => {
      const { responsible } = group;
      const school = responsible.kind === 'school' ? responsible.name : null;
      return {
        name:
          responsible.kind === 'unaffiliated'
            ? 'Not from a school'
            : responsible.name,
        summary:
          group.judgesOwed === null
            ? `${group.judgesNamed} accepted eligible judges · obligations unconfigured`
            : responsible.kind === 'unaffiliated'
              ? 'no one owes them'
              : owing(group.judgesOwed, group.judgesNamed),
        remind:
          school !== null &&
          group.judgesOwed !== null &&
          group.judgesNamed < group.judgesOwed &&
          view.capabilities.manageJudges
            ? sampleAction('Remind the coach')
            : null,
        judges: group.judges.map((judge) => {
          const never = [
            ...(school === null ? [] : [`${school}'s entries`]),
            // The sample's wording; no stored datum gives a judge's pronoun.
            ...judge.strikes.map((strike) =>
              strike.source === 'entry'
                ? `${strike.entryName}, who struck this judge`
                : strike.entryName,
            ),
          ];
          return {
            name: judge.name,
            slots: judge.slots.map(slotOf),
            cleared: judge.clearedFor.length > 0,
            clearedFor:
              judge.clearedFor.length === 0
                ? 'Not cleared yet'
                : clearedFor(judge.clearedFor),
            judged: judge.judgedCount,
            neverJudges:
              judge.declaredConflict?.note ??
              (never.length === 0 ? 'No one' : never.join(' · ')),
            conflict: judge.declaredConflict !== null,
          };
        }),
      };
    }),
    more:
      view.notShown === null
        ? null
        : sampleAction(
            `Show ${view.notShown.count} more from ${view.notShown.schoolName}`,
          ),
  };
}

const dayLabel = (instant: string): string => {
  const date = new Date(instant);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    date.getUTCDay()
  ];
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'June',
    'July',
    'Aug',
    'Sept',
    'Oct',
    'Nov',
    'Dec',
  ][date.getUTCMonth()];
  return `${weekday} ${date.getUTCDate()} ${month}`;
};

/** A responsible adult's entries screen at one tournament. */
function schoolEntriesOf(view: SchoolEntriesView, slug: string): SchoolEntries {
  const edit = sampleAction('Edit');
  const guardian = view.responsible.kind === 'guardian';
  const blocked = view.students.filter((student) => student.clash !== null);
  const { judges } = view;
  const judgeDue =
    judges.named < judges.owed && judges.dueAt !== null
      ? ` You can add the ${ordinal(judges.named + 1)} judge until ${dayLabel(judges.dueAt)}.`
      : '';
  return {
    tournament: { name: view.tournamentName, href: tabRoutes.tournament(slug) },
    title: `${view.responsible.name}'s entries`,
    lede: view.terms,
    students: view.students.map((student) => ({
      name: student.name,
      note: student.note,
      events: student.entries
        .map((entry) =>
          entry.partnerNames.length === 0
            ? entry.eventName
            : `${entry.eventName} with ${entry.partnerNames.join(' and ')}`,
        )
        .join(' · '),
      problem:
        student.clash === null
          ? null
          : `${student.clash.eventNames[0]} and ${student.clash.eventNames[1]} run at the same time. Keep one.`,
      edit,
    })),
    add: sampleAction(guardian ? 'Add a child' : 'Add a student'),
    judges: {
      title: `You owe ${plural(judges.owed, 'judge')}, and have named ${judges.named}`,
      detail: judges.terms,
      add: sampleAction('Add'),
    },
    submit: {
      label: 'Submit entries',
      blocked: blocked.length > 0,
      note:
        blocked.length > 0
          ? `Fix ${blocked.map((student) => `${student.name}'s`).join(' and ')} entry to submit.${judgeDue}`
          : 'You can change entries until they close.',
    },
  };
}

export const readHostEntries = (
  slug: string,
  scene: SampleScene,
): HostEntries | null => {
  const view = sampleEntryList(slug, scene);
  return view === null ? null : hostEntriesOf(view, varsitySwitch(scene));
};

export const readHostJudges = (
  slug: string,
  scene: SampleScene,
): HostJudges | null => {
  const view = sampleJudgeList(slug, scene);
  return view === null ? null : hostJudgesOf(view);
};

export const readSchoolEntries = (
  slug: string,
  scene: SampleScene,
): SchoolEntries | null => {
  const view = sampleSchoolEntries(slug, scene);
  return view === null ? null : schoolEntriesOf(view, slug);
};
