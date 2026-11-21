import type { CompletionContext } from '../../../features/tab/completion-form';
import type { CommandAction, TabAction } from '../../../features/tab/action';
import type { ReactNode } from 'react';
import type {
  Certification,
  ResultsScreen,
} from '../../../features/tab/results';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { Bracket } from '../bracket/bracket';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/** Certifying the event: what holds it back, the action, or when it was done. */
function Certify({
  certification,
  render,
}: {
  readonly certification: Certification;
  readonly render: (action: TabAction<CompletionContext>) => ReactNode;
}) {
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
      return render(certification.certify);
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
  screen,
  renderCommand,
}: {
  readonly screen: ResultsScreen;
  readonly renderCommand?: (
    action: CommandAction<CompletionContext>,
  ) => ReactNode;
}) {
  const { rail, event, results } = screen;
  const render = (action: TabAction<CompletionContext>) =>
    action.kind === 'command' ? (
      renderCommand?.(action)
    ) : (
      <ActionButton action={action} />
    );
  return (
    <HostShell rail={rail} current="results">
      <EventSwitcher event={event} />
      <PageHeader
        title="Results"
        lede={results.lede}
        actions={
          <Certify certification={results.certification} render={render} />
        }
      />
      <Bracket bracket={results.bracket} />
      {results.postingOpenings?.length ? (
        <ListCard>
          <ListHeading>Round postings</ListHeading>
          <ul>
            {results.postingOpenings.map((posting) => (
              <ListRow
                key={posting.id}
                title={posting.label}
                trailing={render(posting.release)}
              />
            ))}
          </ul>
        </ListCard>
      ) : null}
      <div className="grid grid-cols-2 items-start gap-5 max-rail:grid-cols-1">
        <ListCard>
          <ListHeading>{results.audiencesHeading}</ListHeading>
          <ul>
            {results.audiences.map((audience) => (
              <ListRow
                key={audience.id}
                title={audience.audience}
                detail={audience.detail}
                trailing={
                  audience.release?.length ? (
                    <div className="flex flex-col gap-3">
                      {audience.release.map((action) => (
                        <div key={action.label}>{render(action)}</div>
                      ))}
                    </div>
                  ) : audience.open ? (
                    <ActionButton action={audience.open} />
                  ) : audience.status === 'closed' ? null : (
                    <span className="text-sm font-strong text-accent">
                      {audience.status === 'open'
                        ? 'Open'
                        : 'Requires release authority'}
                    </span>
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
                key={check.id}
                title={check.title}
                detail={
                  <>
                    {check.detail}
                    {check.action === null ? null : (
                      <div className="mt-2">
                        <ActionButton size="small" action={check.action} />
                      </div>
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
