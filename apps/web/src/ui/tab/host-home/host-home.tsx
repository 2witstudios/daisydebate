import type { HostHome as Read } from '../../../features/tab/organization';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/** Host home: every tournament and league the viewer holds a grant on. */
export function HostHome({
  rail,
  home,
}: {
  readonly rail: TimelineRail;
  readonly home: Read;
}) {
  return (
    <HostShell rail={rail} current={null}>
      <PageHeader
        title="Your tournaments"
        actions={<ActionButton action={home.create} />}
      />
      <ListCard>
        {home.groups.map((group) => (
          <section key={group.heading}>
            <ListHeading>{group.heading}</ListHeading>
            <ul>
              {group.tournaments.map((tournament) => (
                <ListRow
                  key={tournament.name}
                  title={tournament.name}
                  facts={tournament.owner}
                  detail={tournament.detail}
                  trailing={
                    <ActionButton
                      action={tournament.action}
                      about={tournament.name}
                    />
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </ListCard>
      <div className="grid grid-cols-2 gap-5 max-compact:grid-cols-1">
        {home.cards.map((card) => (
          <section
            key={card.title}
            className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface-raised p-5"
          >
            <h2 className="font-strong">{card.title}</h2>
            <p className="text-sm text-ink-muted">{card.detail}</p>
            <ActionLink action={card.action} />
          </section>
        ))}
      </div>
    </HostShell>
  );
}
