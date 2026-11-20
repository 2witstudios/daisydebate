import { linkTo } from './action';
import type { HostEventsView } from '@daisy/protocol/lobby/host-events-read';
import type {
  SetupEvent,
  TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import type { Choice, TabAction } from './action';
import { hostRoutes } from './routes';

type ScheduledEvent = {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly href: string;
};

/** Events that share time slots, and so run together. */
type EventGroup = {
  readonly name: string;
  readonly times: string;
  readonly events: readonly ScheduledEvent[];
};

type EventForm = {
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
  readonly entryLimit:
    | { readonly kind: 'unconfigured' }
    | {
        readonly kind: 'configured';
        readonly rule: string;
        readonly source: string;
      };
  readonly judgePool:
    | { readonly kind: 'unconfigured'; readonly action: TabAction | null }
    | {
        readonly kind: 'configured';
        readonly rule: string;
        readonly action: TabAction;
      };
  readonly selected: EventForm | null;
};

/** The form's fields the setup read does not decide, as the screen words them. */
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
    const overlapping = groups.filter((members) =>
      members.some((member) =>
        [...slotsOf(member)].some((id) => slots.has(id)),
      ),
    );
    if (overlapping.length === 0) groups.push([event]);
    else {
      const first = overlapping[0]!;
      first.push(...overlapping.slice(1).flat(), event);
      for (const other of overlapping.slice(1))
        groups.splice(groups.indexOf(other), 1);
    }
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

export type EventAside =
  | { readonly kind: 'none' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly event: SetupEvent };
/** Only persisted identity selects an edit; opening or cancelling an aside describes no command. */
export function eventAside(
  setup: TournamentSetupView,
  input: { readonly create: boolean; readonly eventId: string | null },
): EventAside | null {
  if (input.create) return input.eventId === null ? { kind: 'create' } : null;
  if (input.eventId === null) return { kind: 'none' };
  const event = setup.events.find((event) => event.eventId === input.eventId);
  return event ? { kind: 'edit', event } : null;
}
export function storedEventsSchedule(view: HostEventsView): EventsSchedule {
  const setup = view.setup,
    groups = groupsOf(setup.events);
  return {
    lede: `${setup.events.length} events in ${countWords(groups.length)} groups. Events in a group share time slots.`,
    actions: [
      linkTo('Add event', `${hostRoutes.events(setup.handle)}?new=event`),
    ],
    groups: groups.map((group) => ({
      ...timesOf(setup, group),
      events: group.map((event) => ({
        slug: event.eventId,
        name: event.name,
        summary: `${event.format.name} · ${event.tabRounds.length} tab rounds`,
        href: hostRoutes.events(setup.handle, event.eventId),
      })),
    })),
    entryLimit: { kind: 'unconfigured' },
    judgePool: { kind: 'unconfigured', action: null },
    selected: null,
  };
}
