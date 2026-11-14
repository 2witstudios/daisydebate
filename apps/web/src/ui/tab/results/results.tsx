import type {
  Certification,
  EventResults,
} from '../../../features/tab/results';
import type { EventSwitch } from '../../../features/tab/setup';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { Bracket } from '../bracket/bracket';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/** Certifying the event: what holds it back, the action, or when it was done. */
function Certify({ certification }: { readonly certification: Certification }) {
  switch (certification.kind) {
    case 'blocked':
      return (
        <p className="text-sm text-ink-muted">
          <strong className="font-strong text-ink">
            Not ready to certify.
          </strong>{' '}
          {certification.reason}
        </p>
      );
    case 'ready':
      return <ActionButton action={certification.certify} />;
    case 'certified':
      return (
        <p className="text-sm font-strong">Certified at {certification.at}</p>
      );
  }
}

/**
 * An event's results: the bracket, which audience each part of a ballot has
 * opened to, and what stands between the host and certifying.
 */
export function Results({
  rail,
  event,
  results,
}: {
  readonly rail: TimelineRail;
  readonly event: EventSwitch;
  readonly results: EventResults;
}) {
  return (
    <HostShell rail={rail} current="results">
      <EventSwitcher event={event} />
      <PageHeader
        title="Results"
        lede={results.lede}
        actions={<Certify certification={results.certification} />}
      />
      <Bracket bracket={results.bracket} />
      <div className="grid grid-cols-2 items-start gap-5 max-rail:grid-cols-1">
        <ListCard>
          <ListHeading>{results.audiencesHeading}</ListHeading>
          <ul>
            {results.audiences.map((audience) => (
              <ListRow
                key={audience.audience}
                title={audience.audience}
                detail={audience.detail}
                trailing={
                  audience.open === null ? (
                    <span className="text-sm font-strong text-accent">
                      Open
                    </span>
                  ) : (
                    <ActionButton action={audience.open} />
                  )
                }
              />
            ))}
          </ul>
        </ListCard>
        <ListCard>
          <ListHeading>Before you certify</ListHeading>
          <ul>
            {results.checks.map((check) => (
              <ListRow
                key={check.kind}
                title={check.title}
                detail={
                  <>
                    {check.detail}
                    {check.action === null ? null : (
                      <ActionLink action={check.action} className="block" />
                    )}
                  </>
                }
              />
            ))}
          </ul>
        </ListCard>
      </div>
    </HostShell>
  );
}
