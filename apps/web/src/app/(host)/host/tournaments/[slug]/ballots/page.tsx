import { hostBallotBoard } from '../../../../../../features/tab/host-ballot-board';
import { systemId } from '@daisy/clock';
import { roundBallotReadSchema } from '@daisy/protocol/round-ballot-read';
import { hostBallotsViewSchema } from '@daisy/protocol/lobby/host-ballots-read';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readOwnRoute } from '../../../../../../server/render-read';
import { linkTo } from '../../../../../../features/tab/action';
import { hostBallotsPath } from '../../../../../../features/tab/host-ballots-route';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { HostBallots } from '../../../../../../ui/tab/ballots/host-ballots';
import { ScreeningEditor } from '../../../../../../ui/tab/ballots/screening-editor';
import { GET as ballotGET } from '../../../../../api/rounds/[roundId]/ballots/route';
import { GET as indexGET } from '../../../../../api/tab/host-ballots/route';
import { readStoredHostNavigation } from '../../../read-navigation';
import { eventCompletionAction } from '../completion-actions';

export const metadata: Metadata = { title: 'Ballots' };
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{
    event?: string | string[];
    round?: string | string[];
  }>;
}) {
  await requireTabRelease();
  const { slug } = await params,
    query = await searchParams;
  const navigation = await readStoredHostNavigation('lobby', slug);
  if (!navigation) notFound();
  const event =
    typeof query.event === 'string'
      ? navigation.events.find((one) => one.eventId === query.event)
      : navigation.events[0];
  if (!event) notFound();
  const index = await readOwnRoute(
    indexGET,
    hostBallotsPath(navigation.id, event.eventId),
    hostBallotsViewSchema,
  );
  if (!index) notFound();
  const selected =
    typeof query.round === 'string'
      ? index.rounds.find((one) => one.roundId === query.round)
      : index.rounds[0];
  if (typeof query.round === 'string' && !selected) notFound();
  const view = selected
    ? await readOwnRoute(
        (request) =>
          ballotGET(request, {
            params: Promise.resolve({ roundId: selected.roundId }),
          }),
        `/api/rounds/${selected.roundId}/ballots`,
        roundBallotReadSchema,
      )
    : null;
  const path = (eventId: string, roundId?: string) =>
    `${hostRoutes.ballots(slug)}?${new URLSearchParams({ event: eventId, ...(roundId ? { round: roundId } : {}) })}`;
  return (
    <HostBallots
      rail={hostNavigationRail(navigation)}
      event={{
        current: event.name,
        position: `${navigation.events.indexOf(event) + 1} of ${navigation.events.length}`,
        others: navigation.events
          .filter((one) => one.eventId !== event.eventId)
          .map((one) => linkTo(one.name, path(one.eventId))),
      }}
      rounds={index.rounds.map((one, position) => ({
        id: one.roundId,
        action: linkTo(
          `${one.roomTitle} · Ballot group ${position + 1}`,
          path(event.eventId, one.roundId),
          selected?.roundId === one.roundId,
        ),
      }))}
      board={hostBallotBoard(
        view,
        selected && index.canResolve
          ? {
              lobbyId: index.lobbyId,
              eventId: index.eventId,
              handle: slug,
              roundId: selected.roundId,
              nextId: systemId.next,
            }
          : null,
      )}
      renderCommand={({ command }) => (
        <ScreeningEditor
          written={command.written}
          action={eventCompletionAction.bind(null, command.context)}
        />
      )}
    />
  );
}
