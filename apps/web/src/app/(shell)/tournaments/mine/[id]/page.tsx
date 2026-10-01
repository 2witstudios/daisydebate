import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  eventFlow,
  parseEventMoment,
} from '../../../../../features/tournaments/event';
import { getEvent } from '../../../../../features/tournaments/get-event';
import { requireAccess } from '../../../../../lib/access';
import {
  EventPage,
  NotInEvent,
} from '../../../../../ui/tournaments/event/event-page';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'My event' };

export default async function MyEventRoute({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAccess(`/tournaments/mine/${id}`, searchParams);
  const now = systemClock.now();
  const data = getEvent(id, now);
  if (!data) return <NotInEvent tournament={null} />;
  const screen = eventFlow(data, parseEventMoment(await searchParams), now);
  return (
    <EventPage
      screen={screen}
      tournament={data.tournament}
      finalAt={data.final.startsAt}
    />
  );
}
