import type {
  SetupEvent,
  TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import type { Choice, TabAction } from './action';
import { hostRoutes } from './routes';
import { sampleEventsSchedule } from './sample/events';
import type { SampleScene } from './sample/scene';

export type ScheduledEvent = {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly href: string;
};

/** Events that share time slots, and so run together. */
export type EventGroup = {
  readonly name: string;
  readonly times: string;
  readonly events: readonly ScheduledEvent[];
};

export type EventForm = {
  readonly slug: string;
  readonly name: string;
  readonly format: { readonly value: string; readonly source: string };
  readonly divisions: Choice;
  readonly novice: { readonly value: string; readonly source: string };
  readonly prelimRounds: Choice;
  readonly openBreak: Choice;
  readonly noviceBreak: Choice;
  readonly doubleQualifier: Choice;
  readonly runsWith: Choice;
  readonly settings: TabAction;
  readonly remove: TabAction;
};

export type EventsSchedule = {
  readonly lede: string;
  readonly actions: readonly TabAction[];
  readonly groups: readonly EventGroup[];
  readonly entryLimit: { readonly rule: string; readonly source: string };
  readonly judgePool: { readonly rule: string; readonly action: TabAction };
  readonly selected: EventForm | null;
};

/** The form's fields the setup read does not decide, as the screen words them. */
export type EventFormCopy = Omit<EventForm, 'slug' | 'name' | 'format'>;

/** The words the events screen uses, beyond what the setup read carries. */
export type EventsCopy = {
  readonly actions: readonly TabAction[];
  /** Each event's one-line summary, by event. */
  readonly summaries: Readonly<Record<string, string>>;
  /** The edit form of each event that has one, by event. */
  readonly forms: Readonly<Record<string, EventFormCopy>>;
  /** The event the screen opens on when the address names none. */
  readonly opening: string;
  readonly entryLimit: string;
  readonly judgePool: { readonly rule: string; readonly action: TabAction };
};

/** An event's place in a host address: its name, lowercased and hyphenated. */
export const eventSlug = (event: { readonly name: string }): string =>
  event.name.trim().toLowerCase().replaceAll(/\s+/g, '-');

const numberWords = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const countWords = (count: number) => numberWords[count] ?? String(count);

const slotsOf = (event: SetupEvent) =>
  new Set(
    event.tabRounds.flatMap((round) =>
      round.timeSlotId === null ? [] : [round.timeSlotId],
    ),
  );

/** Events that share any time slot run together: one group each. */
function groupsOf(events: readonly SetupEvent[]): readonly SetupEvent[][] {
  const groups: SetupEvent[][] = [];
  for (const event of events) {
    const slots = slotsOf(event);
    const group = groups.find((members) =>
      members.some((member) => [...slotsOf(member)].some((id) => slots.has(id))),
    );
    if (group) group.push(event);
    else groups.push([event]);
  }
  return groups;
}

const clock = (instant: string) => instant.slice(11, 16);

/**
 * A group's times, earliest first: a preliminary slot by its time, a slot
 * that opens an elimination stage by its name and time (`break 16:45`).
 */
function timesOf(
  setup: TournamentSetupView,
  group: readonly SetupEvent[],
): { readonly name: string; readonly times: string } {
  const elimination = new Set(
    group.flatMap((event) =>
      event.stages
        .filter((stage) => stage.kind === 'elimination')
        .map((stage) => stage.stageId),
    ),
  );
  const used = new Map(
    group.flatMap((event) =>
      event.tabRounds.flatMap((round) =>
        round.timeSlotId === null
          ? []
          : [[round.timeSlotId, elimination.has(round.stageId)] as const],
      ),
    ),
  );
  const slots = setup.timeSlots
    .filter((slot) => used.has(slot.timeSlotId))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    name: slots[0]?.name ?? '',
    times: slots
      .map((slot) =>
        used.get(slot.timeSlotId)
          ? `${slot.name} ${clock(slot.startsAt)}`
          : clock(slot.startsAt),
      )
      .join(', '),
  };
}

/** The events and schedule screen from a tournament's setup read. */
export function eventsScheduleOf(
  setup: TournamentSetupView,
  selected: string | null,
  copy: EventsCopy,
): EventsSchedule {
  const groups = groupsOf(setup.events);
  const chosen = setup.events.find(
    (event) => eventSlug(event) === (selected ?? copy.opening),
  );
  const form = chosen === undefined ? undefined : copy.forms[chosen.eventId];
  const owner = setup.owner?.name ?? setup.name;
  return {
    lede: `${setup.events.length} events in ${countWords(groups.length)} groups. Events in a group run at the same time.`,
    actions: copy.actions,
    groups: groups.map((group) => ({
      ...timesOf(setup, group),
      events: group.map((event) => ({
        slug: eventSlug(event),
        name: event.name,
        summary: copy.summaries[event.eventId] ?? '',
        href: hostRoutes.events(setup.handle, eventSlug(event)),
      })),
    })),
    entryLimit: { rule: copy.entryLimit, source: `Set by ${owner}.` },
    judgePool: copy.judgePool,
    selected:
      chosen === undefined || form === undefined
        ? null
        : {
            slug: eventSlug(chosen),
            name: chosen.name,
            format: {
              value: chosen.format.name,
              source: `set by ${chosen.template?.organization.name ?? owner}`,
            },
            ...form,
          },
  };
}

export const readEventsSchedule = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): EventsSchedule | null => {
  const sample = sampleEventsSchedule(slug, scene);
  return sample === null
    ? null
    : eventsScheduleOf(sample.setup, event, sample.copy);
};
