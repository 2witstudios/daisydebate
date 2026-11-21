import { notFound } from 'next/navigation';
import { linkTo } from '../../../../features/tab/action';
import { hostRoutes, tabRoutes } from '../../../../features/tab/routes';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { ActionButton } from '../../../../ui/tab/action-control/action-control';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../ui/tab/list-card/list-card';
import { storedTournament } from '../read-tournament';

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const view = await storedTournament((await params).slug);
  if (!view) notFound();
  return (
    <div className="mx-auto flex max-w-dash-column flex-col gap-5 px-4 py-6">
      <PageHeader
        title={view.name}
        lede={view.status}
        actions={
          <ActionButton
            action={linkTo(
              view.registration.length ? 'Enter' : 'Entries',
              tabRoutes.entries(view.handle),
              view.registration.length > 0,
            )}
          />
        }
      />
      {view.ownRooms.length > 0 ? (
        <ListCard>
          <ListHeading>Your room</ListHeading>
          <ul>
            {view.ownRooms.map((room) => (
              <ListRow
                key={room.fixtureId}
                title={room.roomName ?? room.round.round ?? 'Room'}
                detail={room.round.event}
                trailing={
                  room.roomId && (
                    <ActionButton
                      action={linkTo(
                        room.ballotDue ? 'Your ballot' : 'Open room',
                        room.ballotDue
                          ? tabRoutes.ballot(room.roomId)
                          : room.live
                            ? tabRoutes.liveRoom(room.roomId)
                            : tabRoutes.room(room.roomId),
                        true,
                      )}
                    />
                  )
                }
              />
            ))}
          </ul>
        </ListCard>
      ) : null}
      <ListCard>
        <ListHeading>Schedule</ListHeading>
        <ul>
          {view.schedule.map((round) => (
            <ListRow
              key={round.roundId ?? round.eventId}
              title={
                round.number
                  ? `${round.event} · ${round.round ?? `Round ${round.number}`}`
                  : round.event
              }
              detail={
                round.startsAt
                  ? `${round.startsAt.slice(0, 10)} · ${round.startsAt.slice(11, 16)} UTC`
                  : 'Unscheduled'
              }
              trailing={
                round.posted && round.roundId ? (
                  <ActionButton
                    action={linkTo(
                      'View posting',
                      tabRoutes.round(
                        view.handle,
                        round.eventId,
                        round.roundId,
                      ),
                    )}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      </ListCard>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          action={linkTo('Standings', tabRoutes.standings(view.handle))}
        />
        <ActionButton
          action={linkTo('Bracket', tabRoutes.bracket(view.handle))}
        />
        {view.host ? (
          <ActionButton
            action={linkTo('Host area', hostRoutes.tournament(view.handle))}
          />
        ) : null}
      </div>
    </div>
  );
}
