import { commandAction, linkTo } from './action';
import type { EventFormContext } from './event-form';
import type { HostEventsView } from '@daisy/protocol/lobby/host-events-read';
import type {
  SetupEvent,
  TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import type { TabAction } from './action';
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

type EventsSchedule = {
  readonly lede: string;
  readonly actions: readonly TabAction[];
  readonly groups: readonly EventGroup[];
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
function eventScheduleSummary(view: HostEventsView): EventsSchedule {
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
  };
}

/** The event board's controls are projected from one guarded schedule read. */
export function eventScheduleBoard(
  view: HostEventsView,
  selection: {
    readonly create: boolean;
    readonly eventId: string | null;
    readonly nextId: () => string;
  },
) {
  const { setup, resolutionChoices, pinOptions } = view;
  const aside = eventAside(setup, selection);
  if (!aside) return null;
  const event = aside.kind === 'edit' ? aside.event : null;
  const base = {
    handle: setup.handle,
    lobbyId: setup.lobbyId,
    lobbyVersion: view.lobbyVersion,
    returnEventId: event?.eventId ?? null,
  };
  const act = <Target extends EventFormContext['target']>(
    label: string,
    target: Target,
  ) =>
    commandAction<
      Omit<EventFormContext, 'target'> & { readonly target: Target }
    >(label, { ...base, target, commandId: selection.nextId() });
  const availableSlots = setup.timeSlots.map(({ timeSlotId, name }) => ({
    timeSlotId,
    name,
  }));
  return {
    ...eventScheduleSummary(view),
    selectedEventId: event?.eventId ?? null,
    cancel: linkTo('Cancel', hostRoutes.events(setup.handle)),
    aside:
      aside.kind === 'create'
        ? {
            kind: 'create' as const,
            save: act('Create event', { kind: 'create', pinOptions }),
          }
        : event
          ? {
              kind: 'edit' as const,
              event,
              save: act('Save event', {
                kind: 'edit',
                eventId: event.eventId,
                ballotDefinition: event.ballotDefinition
                  ? {
                      id: event.ballotDefinition.ballotDefinitionId,
                      version: event.ballotDefinition.ballotDefinitionVersion,
                    }
                  : null,
              }),
              links: [
                linkTo(
                  'Event settings',
                  `${hostRoutes.setup(setup.handle)}?event=${event.eventId}`,
                ),
                linkTo(
                  'Ballot definition',
                  hostRoutes.ballot(setup.handle, event.eventId),
                ),
                linkTo(
                  'Resolutions',
                  hostRoutes.resolutions(setup.handle, event.eventId),
                ),
              ],
              remove: act('Remove event', {
                kind: 'command',
                command: {
                  type: 'remove-event',
                  lobbyId: setup.lobbyId,
                  eventId: event.eventId,
                },
              }),
            }
          : null,
    editor: event
      ? {
          title: `${event.name} stages and rounds`,
          addStage: act('Add stage', {
            kind: 'add-stage',
            eventId: event.eventId,
          }),
          stages: event.stages.map((stage) => ({
            ...stage,
            add: act('Add round', {
              kind: 'add-round',
              stageId: stage.stageId,
              resolutionChoices,
            }),
            rounds: event.tabRounds
              .filter((round) => round.stageId === stage.stageId)
              .map((round) => ({
                ...round,
                title: round.name ?? `Round ${round.number}`,
                open: linkTo(
                  'Open draw',
                  hostRoutes.round(
                    setup.handle,
                    event.eventId,
                    round.tabRoundId,
                  ),
                ),
                resolution: round.poolResolutionId
                  ? `word:${round.poolResolutionId}`
                  : round.resolutionPoolId
                    ? `pool:${round.resolutionPoolId}`
                    : '',
                save: view.publishedRoundIds?.includes(round.tabRoundId)
                  ? null
                  : act('Save round', {
                      kind: 'edit-round',
                      tabRoundId: round.tabRoundId,
                      resolutionChoices,
                      ...(view.releasedResolutionRoundIds?.includes(
                        round.tabRoundId,
                      )
                        ? {
                            lockedResolution: round.resolutionPoolId
                              ? {
                                  poolId: round.resolutionPoolId,
                                  poolResolutionId: round.poolResolutionId,
                                }
                              : null,
                          }
                        : {}),
                    }),
                place:
                  stage.timing === 'live' &&
                  !view.publishedRoundIds?.includes(round.tabRoundId)
                    ? act('Place round', {
                        kind: 'place-round',
                        tabRoundId: round.tabRoundId,
                        timeSlots: availableSlots,
                      })
                    : null,
              })),
          })),
        }
      : null,
    openTournament:
      setup.status === 'draft'
        ? act('Open tournament', {
            kind: 'command',
            command: {
              type: 'set-tournament-status',
              lobbyId: setup.lobbyId,
              status: 'open',
            },
          })
        : null,
    slots: setup.timeSlots.flatMap((slot) => {
      const slotVersion = view.timeSlotVersions.find(
        (one) => one.timeSlotId === slot.timeSlotId,
      )?.version;
      if (slotVersion === undefined) return [];
      return [
        {
          ...slot,
          open: linkTo(
            'Open time slot',
            hostRoutes.slot(setup.handle, slot.timeSlotId),
          ),
          save: act('Save time slot', {
            kind: 'edit-slot',
            timeSlotId: slot.timeSlotId,
            slotVersion,
          }),
          remove: act('Remove time slot', {
            kind: 'command',
            slotVersion,
            command: {
              type: 'remove-time-slot',
              lobbyId: setup.lobbyId,
              timeSlotId: slot.timeSlotId,
            },
          }),
        },
      ];
    }),
    addSlot: act('Add time slot', { kind: 'add-slot' }),
    pools: setup.resolutionPools,
    addResolution: act('Add resolution', {
      kind: 'add-resolution',
      pools: setup.resolutionPools.map(({ resolutionPoolId, name }) => ({
        poolId: resolutionPoolId,
        name,
      })),
    }),
  };
}
