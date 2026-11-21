import type { HostRoundView } from '@daisy/protocol/lobby/draw-read';
import { runningRoundOf } from './tab-round';
import type { HostNavigationView } from '@daisy/protocol/lobby/host-navigation-read';
import { linkTo } from './action';
import { hostRoutes, tabRoutes } from './routes';
import { hostNavigationRail } from './host-navigation';

export function hostTimeSlot(
  navigation: HostNavigationView,
  slotId: string,
  eventId: string | null,
  readRounds: ReadonlyMap<string, HostRoundView> = new Map(),
) {
  if (!navigation.schedule) return null;
  const { slots, rounds: schedule } = navigation.schedule;
  const index = slots.findIndex((slot) => slot.timeSlotId === slotId);
  const slot = slots[index];
  if (!slot) return null;
  const events = navigation.events.flatMap((event) => {
    const rounds = schedule.filter(
      (round) => round.timeSlotId === slotId && round.eventId === event.eventId,
    );
    return rounds.length ? [{ event, rounds }] : [];
  });
  if (
    eventId !== null &&
    !events.some(({ event }) => event.eventId === eventId)
  )
    return null;
  const address = (id: string | null) =>
    hostRoutes.slot(navigation.handle, slotId, id);
  const next = slots[index + 1];
  return {
    title: slot.name,
    startsAt: slot.startsAt,
    participantView: linkTo(
      'View as participant',
      tabRoutes.tournament(navigation.handle),
    ),
    tabs: [
      {
        id: 'all',
        label: 'All events',
        href: address(null),
        selected: eventId === null,
      },
      ...events.map(({ event }) => ({
        id: event.eventId,
        label: event.name,
        href: address(event.eventId),
        selected: event.eventId === eventId,
      })),
    ],
    events: events
      .filter(({ event }) => eventId === null || event.eventId === eventId)
      .map(({ event, rounds }) => ({
        event,
        rounds: rounds.map((round) => {
          const stored = readRounds.get(round.tabRoundId);
          const roundAddress = (fixtureId?: string) =>
            hostRoutes.round(
              navigation.handle,
              event.eventId,
              round.tabRoundId,
              fixtureId,
            );
          const running =
            stored?.kind === 'published'
              ? runningRoundOf(stored.round, {
                  event: { current: event.name, position: '', others: [] },
                  address: {
                    posting: tabRoutes.round(
                      navigation.handle,
                      event.eventId,
                      round.tabRoundId,
                    ),
                    tournament: tabRoutes.tournament(navigation.handle),
                    nextDraw: null,
                  },
                  wallClock: (at) => at.slice(11, 16),
                  fixtureAction: (fixture) =>
                    linkTo('Review fixture', roundAddress(fixture.fixtureId)),
                })
              : null;
          return {
            ...round,
            action: linkTo('Open round', roundAddress()),
            status:
              running?.lede ?? (stored?.kind === 'draft' ? 'Draft draw' : null),
            groups: running?.groups.filter((group) => group.rooms.length) ?? [],
          };
        }),
      })),
    next: next
      ? linkTo(next.name, hostRoutes.slot(navigation.handle, next.timeSlotId))
      : null,
    rail: hostNavigationRail(navigation),
  };
}
