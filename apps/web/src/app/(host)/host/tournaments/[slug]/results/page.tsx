import { systemId } from '@daisy/clock';
import { hostResultsViewSchema } from '@daisy/protocol/lobby/results-read';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { hostResultsPath } from '../../../../../../features/tab/host-results-route';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { hostResultsScreenOf } from '../../../../../../features/tab/results';
import { CommandControl } from '../../../../../../ui/tab/action-control/command-control';
import { Results } from '../../../../../../ui/tab/results/results';
import { GET } from '../../../../../api/tab/host-results/route';
import { readStoredHostNavigation } from '../../../read-navigation';
import { eventCompletionAction } from '../completion-actions';

export const metadata: Metadata = { title: 'Results' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug } = await params;
  await requireTabRelease();
  const navigation = await readStoredHostNavigation('lobby', slug);
  if (!navigation) notFound();
  const { event } = await searchParams;
  const selected =
    typeof event === 'string'
      ? navigation.events.find((one) => one.eventId === event)
      : navigation.events[0];
  if (!selected) notFound();
  const read = await readOwnRoute(
    GET,
    hostResultsPath(navigation.id, selected.eventId),
    hostResultsViewSchema,
  );
  if (!read) notFound();
  const screen = hostResultsScreenOf(navigation, read, systemId.next);
  if (!screen) notFound();
  return (
    <Results
      screen={screen}
      renderCommand={(action) => (
        <CommandControl
          action={action}
          bind={(command) => eventCompletionAction.bind(null, command)}
        >
          {null}
        </CommandControl>
      )}
    />
  );
}
