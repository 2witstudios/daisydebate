import { systemId } from '@daisy/clock';
import { notFound } from 'next/navigation';
import { eventScheduleBoard } from '../../../../../../features/tab/events';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { EventsSchedule } from '../../../../../../ui/tab/events-schedule/events-schedule';
import { readStoredHostNavigation } from '../../../read-navigation';
import { eventAction } from './actions';
import { readStoredHostEvents } from './read-events';

export async function StoredEvents({
  handle,
  eventId,
  create,
}: {
  readonly handle: string;
  readonly eventId: string | null;
  readonly create: boolean;
}) {
  await requireTabRelease();
  const navigation = await readStoredHostNavigation('lobby', handle);
  if (!navigation) notFound();
  const view = await readStoredHostEvents(navigation.id);
  if (!view) notFound();
  const board = eventScheduleBoard(view, {
    create,
    eventId,
    nextId: systemId.next,
  });
  if (!board) notFound();
  return (
    <EventsSchedule
      rail={hostNavigationRail(navigation)}
      board={board}
      bind={(command) => eventAction.bind(null, command)}
    />
  );
}
