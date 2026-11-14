import type { ResolutionPool } from '../../../features/tab/resolution-pool';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { ChoiceField } from '../choice-field/choice-field';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import {
  eyebrowClass,
  ListCard,
  ListHeading,
  ListRow,
} from '../list-card/list-card';

/** The resolution pool, and how each tab round gives a Room its resolution. */
export function Resolutions({
  rail,
  pool,
}: {
  readonly rail: TimelineRail;
  readonly pool: ResolutionPool;
}) {
  return (
    <HostShell
      rail={rail}
      current="setup"
      asideLabel="How each round gets its resolution"
      aside={
        <>
          <h2 className="font-display text-xl font-bold">By round</h2>
          <ul className="flex flex-col">
            {pool.byRound.map((round) => (
              <li
                key={round.rounds}
                className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div className="flex min-w-0 flex-col">
                  <strong className="font-strong">{round.rounds}</strong>
                  <span className="text-sm text-ink-muted">{round.timing}</span>
                </div>
                {round.rule === null ? (
                  <span className="text-sm text-ink-muted">Released</span>
                ) : (
                  <ChoiceField
                    id={`resolution-${round.rounds.toLowerCase().replaceAll(' ', '-')}`}
                    choice={round.rule}
                    layout="beside"
                    hideLabel
                  />
                )}
              </li>
            ))}
          </ul>
          {pool.unreleased === null ? null : (
            <section
              aria-label="The final's resolution"
              className="flex flex-col items-start gap-2 rounded-lg bg-hue-teal-soft p-4"
            >
              <h3 className={eyebrowClass}>{pool.unreleased.heading}</h3>
              <strong className="font-strong">{pool.unreleased.text}</strong>
              <p className="text-sm text-ink-muted">
                {pool.unreleased.readers}
              </p>
              <ActionButton action={pool.unreleased.release} />
            </section>
          )}
        </>
      }
    >
      <ActionLink action={pool.setup} className="self-start" />
      <EventSwitcher event={pool.event} />
      <PageHeader
        title="Resolutions"
        lede={pool.lede}
        actions={<ActionButton action={pool.add} />}
      />
      <ListCard>
        <ListHeading>Pool</ListHeading>
        <ul>
          {pool.pool.map((resolution) => (
            <ListRow
              key={resolution.text}
              title={resolution.text}
              detail={resolution.origin}
              tone={resolution.held ? 'held' : 'plain'}
              trailing={
                resolution.edit === null ? null : (
                  <ActionLink
                    action={resolution.edit}
                    about={resolution.text}
                  />
                )
              }
            />
          ))}
          {pool.more === null ? null : (
            <li className="px-4 py-3">
              <ActionLink action={pool.more} />
            </li>
          )}
        </ul>
      </ListCard>
    </HostShell>
  );
}
