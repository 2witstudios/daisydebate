import { notFound } from 'next/navigation';
import { linkTo } from '../../../../../../../../features/tab/action';
import { tabRoutes } from '../../../../../../../../features/tab/routes';
import { PageHeader } from '../../../../../../../../ui/components/page-header/page-header';
import {
  ActionButton,
  BackButton,
} from '../../../../../../../../ui/tab/action-control/action-control';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../../../../../ui/tab/list-card/list-card';
import { storedTournamentPosting } from '../../../../../read-tournament';

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string; event: string; round: string }>;
}) {
  const { slug, event, round } = await params;
  const view = await storedTournamentPosting(slug, {
    eventId: event,
    roundId: round,
  });
  if (!view?.selected) notFound();
  const posting = view.selected;
  return (
    <div className="mx-auto flex max-w-dash-column flex-col gap-5 px-4 py-6">
      {view.tournamentReadable ? (
        <BackButton
          href={tabRoutes.tournament(view.handle)}
          label={view.name}
        />
      ) : null}
      <PageHeader
        title={posting.round ?? `Round ${posting.number}`}
        lede={posting.event}
      />
      {posting.resolution ? (
        <ListCard>
          <ListHeading>Resolution</ListHeading>
          <p className="p-4">{posting.resolution}</p>
        </ListCard>
      ) : null}
      <ListCard>
        <ListHeading>Posting</ListHeading>
        <ul>
          {posting.fixtures.map((fixture) => (
            <ListRow
              key={fixture.fixtureId}
              title={
                fixture.roomName ?? (fixture.kind === 'bye' ? 'Bye' : 'Fixture')
              }
              detail={[
                fixture.entries.join(
                  fixture.kind === 'section' ? ' · ' : ' v ',
                ),
                fixture.judges.length
                  ? `Judges: ${fixture.judges.join(', ')}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={
                fixture.roomId &&
                (fixture.own || fixture.watchable) && (
                  <ActionButton
                    action={linkTo(
                      fixture.ballotDue
                        ? 'Your ballot'
                        : fixture.own
                          ? 'Your room'
                          : 'Watch',
                      fixture.ballotDue
                        ? tabRoutes.ballot(fixture.roomId)
                        : fixture.live
                          ? tabRoutes.liveRoom(fixture.roomId)
                          : tabRoutes.room(fixture.roomId),
                      fixture.own,
                    )}
                  />
                )
              }
            />
          ))}
        </ul>
        {posting.fixtures.length === 0 ? (
          <p className="p-4">No fixtures published.</p>
        ) : null}
      </ListCard>
    </div>
  );
}
