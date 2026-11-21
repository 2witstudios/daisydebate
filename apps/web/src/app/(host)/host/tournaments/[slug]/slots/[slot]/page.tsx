import { notFound } from 'next/navigation';
import { hostRoundViewSchema } from '@daisy/protocol/lobby/draw-read';
import { hostRoundPath } from '../../../../../../../features/tab/host-draw-route';
import { attentionHeading } from '../../../../../../../ui/tab/running-round/attention-list';
import { readOwnRoute } from '../../../../../../(shell)/friends/read-route';
import { GET } from '../../../../../../api/tab/host-round/route';
import { hostTimeSlot } from '../../../../../../../features/tab/host-time-slot';
import { requireTabRelease } from '../../../../../../../features/tab/release';
import { PageHeader } from '../../../../../../../ui/components/page-header/page-header';
import { TabLinks } from '../../../../../../../ui/components/tab-links/tab-links';
import { ActionButton } from '../../../../../../../ui/tab/action-control/action-control';
import { HostShell } from '../../../../../../../ui/tab/host-shell/host-shell';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../../../../ui/tab/list-card/list-card';
import { readStoredHostNavigation } from '../../../../read-navigation';

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string; slot: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  await requireTabRelease();
  const [{ slug, slot }, { event }] = await Promise.all([params, searchParams]);
  if (Array.isArray(event)) notFound();
  const navigation = await readStoredHostNavigation('lobby', slug);
  if (!navigation) notFound();
  if (!navigation.schedule?.slots.some((one) => one.timeSlotId === slot))
    notFound();
  const rounds = await Promise.all(
    navigation.schedule.rounds
      .filter(
        (round) =>
          round.timeSlotId === slot && (!event || round.eventId === event),
      )
      .map((round) =>
        readOwnRoute(
          GET,
          hostRoundPath({
            lobbyId: navigation.id,
            eventId: round.eventId,
            tabRoundId: round.tabRoundId,
          }),
          hostRoundViewSchema,
        ),
      ),
  );
  const view = hostTimeSlot(
    navigation,
    slot,
    event ?? null,
    new Map(
      rounds.flatMap((round) =>
        round ? [[round.tabRound.tabRoundId, round] as const] : [],
      ),
    ),
  );
  if (!view) notFound();
  return (
    <HostShell rail={view.rail} current={slot}>
      <PageHeader
        title={view.title}
        lede={`${view.startsAt.slice(0, 10)} · ${view.startsAt.slice(11, 16)} UTC`}
        actions={<ActionButton action={view.participantView} />}
      />
      <TabLinks label="Events in this slot" tabs={view.tabs} />
      {view.events.map(({ event: scheduled, rounds }) => (
        <ListCard key={scheduled.eventId}>
          <ListHeading>{scheduled.name}</ListHeading>
          <ul>
            {rounds.map((round) => (
              <ListRow
                key={round.tabRoundId}
                title={round.name ?? `Round ${round.number}`}
                detail={round.status}
                trailing={
                  <ActionButton
                    action={round.action}
                    about={round.name ?? `Round ${round.number}`}
                  />
                }
              />
            ))}
          </ul>
          {rounds.flatMap((round) =>
            round.groups.map((group) => (
              <section key={`${round.tabRoundId}-${group.attention}`}>
                <ListHeading>{attentionHeading(group)}</ListHeading>
                <ul>
                  {group.rooms.map((room) => (
                    <ListRow
                      key={
                        room.action.kind === 'link'
                          ? room.action.href
                          : room.title
                      }
                      title={room.title}
                      detail={room.detail}
                      trailing={
                        <ActionButton action={room.action} about={room.title} />
                      }
                    />
                  ))}
                </ul>
              </section>
            )),
          )}
        </ListCard>
      ))}
      {view.events.length === 0 ? <p>No rounds scheduled.</p> : null}
      {view.next ? <ActionButton action={view.next} /> : null}
    </HostShell>
  );
}
