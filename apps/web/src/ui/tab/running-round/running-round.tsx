import type { RunningRound as Read } from '../../../features/tab/tab-round';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { ListCard } from '../list-card/list-card';
import { AttentionList } from './attention-list';

/** One published tab round: its Rooms by the attention they need. */
export function RunningRound({
  rail,
  current,
  round,
}: {
  readonly rail: TimelineRail;
  readonly current: string;
  readonly round: Read;
}) {
  return (
    <HostShell rail={rail} current={current}>
      <EventSwitcher event={round.event} />
      <PageHeader
        title={round.title}
        lede={round.lede}
        actions={
          <>
            <ActionLink
              action={round.participantView}
              className="self-center"
            />
            {round.next === null ? null : <ActionButton action={round.next} />}
          </>
        }
      />
      <ListCard>
        <AttentionList groups={round.groups} />
      </ListCard>
    </HostShell>
  );
}
