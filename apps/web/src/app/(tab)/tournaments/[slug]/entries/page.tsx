import { systemId } from '@daisy/clock';
import { participantEntriesOf } from '../../../../../features/tab/participant-entries';
import { CommandControl } from '../../../../../ui/tab/action-control/command-control';
import { EntryFields } from './entry-fields';
import { enterTournament } from './actions';
import { notFound } from 'next/navigation';
import { tabRoutes } from '../../../../../features/tab/routes';
import { PageHeader } from '../../../../../ui/components/page-header/page-header';
import { BackButton } from '../../../../../ui/tab/action-control/action-control';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../../ui/tab/list-card/list-card';
import { storedTournament } from '../../read-tournament';

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const tournament = await storedTournament((await params).slug);
  if (!tournament) notFound();
  const view = participantEntriesOf(tournament, () => systemId.next());
  return (
    <div className="mx-auto flex max-w-dash-column flex-col gap-5 px-4 py-6">
      <BackButton href={tabRoutes.tournament(view.handle)} label={view.name} />
      <PageHeader title="Entries" />
      <ListCard>
        <ListHeading>Your entries</ListHeading>
        {view.entries.length === 0 ? (
          <p className="p-4">You have no entries in this tournament.</p>
        ) : null}
        <ul>
          {view.entries.map((entry) => (
            <ListRow
              key={entry.entryId}
              title={entry.name}
              facts={entry.status}
              detail={entry.event}
            />
          ))}
        </ul>
      </ListCard>
      {view.registration.map((event) => (
        <ListCard key={event.eventId}>
          <ListHeading>{event.name}</ListHeading>
          <div className="p-4">
            <CommandControl
              action={event.action}
              bind={(command) => enterTournament.bind(null, command)}
            >
              <EntryFields divisions={event.divisions} />
            </CommandControl>
          </div>
        </ListCard>
      ))}
    </div>
  );
}
