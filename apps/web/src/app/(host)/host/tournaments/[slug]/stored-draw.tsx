import { hostDrawOverviewSchema } from '@daisy/protocol/lobby/draw-read';
import { notFound } from 'next/navigation';
import { readOwnRoute } from '../../../../(shell)/friends/read-route';
import { linkTo } from '../../../../../features/tab/action';
import { hostDrawOverviewPath } from '../../../../../features/tab/host-draw-route';
import { hostNavigationRail } from '../../../../../features/tab/host-navigation';
import { requireTabRelease } from '../../../../../features/tab/release';
import { hostRoutes } from '../../../../../features/tab/routes';
import { PageHeader } from '../../../../../ui/components/page-header/page-header';
import { ActionButton } from '../../../../../ui/tab/action-control/action-control';
import { HostShell } from '../../../../../ui/tab/host-shell/host-shell';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../../ui/tab/list-card/list-card';
import { GET } from '../../../../api/tab/host-draw/route';
import { readStoredHostNavigation } from '../../read-navigation';

export async function StoredDrawOverview({
  handle,
}: {
  readonly handle: string;
}) {
  await requireTabRelease();
  const navigation = await readStoredHostNavigation('lobby', handle);
  if (!navigation) notFound();
  const view = await readOwnRoute(
    GET,
    hostDrawOverviewPath(navigation.id),
    hostDrawOverviewSchema,
  );
  if (!view) notFound();
  return (
    <HostShell rail={hostNavigationRail(navigation)} current="draw">
      <PageHeader
        title="Draw"
        lede="Each event's tab rounds and their stored draws."
      />
      {view.events.length === 0 ? (
        <p>No events have been configured.</p>
      ) : (
        view.events.map((event) => (
          <ListCard key={event.eventId}>
            <ListHeading>{event.name}</ListHeading>
            {event.rounds.length === 0 ? (
              <p className="p-4">No tab rounds have been configured.</p>
            ) : (
              <ul>
                {event.rounds.map((round) => (
                  <ListRow
                    key={round.tabRoundId}
                    title={round.name ?? `Round ${round.number}`}
                    detail={
                      round.draw
                        ? `${round.draw.status === 'draft' ? 'Draft' : 'Published'} ${round.draw.version}`
                        : 'Not drawn'
                    }
                    trailing={
                      <ActionButton
                        action={linkTo(
                          'Open round',
                          hostRoutes.round(
                            handle,
                            event.eventId,
                            round.tabRoundId,
                          ),
                        )}
                      />
                    }
                  />
                ))}
              </ul>
            )}
          </ListCard>
        ))
      )}
    </HostShell>
  );
}
