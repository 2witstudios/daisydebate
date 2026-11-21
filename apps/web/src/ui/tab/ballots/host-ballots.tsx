import type { ReactNode } from 'react';
import type { hostBallotBoard } from '../../../features/tab/host-ballot-board';
import type { TimelineRail } from '../../../features/tab/tournament';
import type { EventSwitch } from '../../../features/tab/setup';
import type { TabAction } from '../../../features/tab/action';
import { subjectOf } from '../../../features/judge/ballot-plan';
import { PageHeader } from '../../components/page-header/page-header';
import { HostShell } from '../host-shell/host-shell';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { ActionButton } from '../action-control/action-control';
import { StoredBallotScores } from '../../ballot/stored-ballot-scores';

/** Real submitted records, using the ordinary ballot owner's filtered read and frozen definition. */
export function HostBallots({
  rail,
  event,
  rounds,
  board,
  renderCommand,
}: {
  readonly rail: TimelineRail;
  readonly event: EventSwitch;
  readonly rounds: readonly {
    readonly id: string;
    readonly action: TabAction;
  }[];
  readonly board: ReturnType<typeof hostBallotBoard>;
  readonly renderCommand: (
    action: NonNullable<
      ReturnType<typeof hostBallotBoard>['ballots'][number]['action']
    >,
  ) => ReactNode;
}) {
  const { plan, ballots } = board;
  return (
    <HostShell rail={rail} current="ballots">
      <EventSwitcher event={event} />
      <PageHeader
        title="Ballots"
        lede="Submitted decisions, scores and written feedback."
      />
      {rounds.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No Round has started in this event yet.
        </p>
      ) : (
        <nav aria-label="Ballot Rounds" className="flex flex-wrap gap-3">
          {rounds.map((row) => (
            <ActionButton key={row.id} action={row.action} size="small" />
          ))}
        </nav>
      )}
      {!plan ? (
        rounds.length === 0 ? null : (
          <p className="text-sm text-ink-muted">
            Ballots for the selected Round are not available to you.
          </p>
        )
      ) : ballots.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No submitted ballot is available to you for this Round.
        </p>
      ) : (
        ballots.map(
          ({ entry: { ballot, judge, review: address }, action }, index) => (
            <section
              key={address?.ballotId ?? index}
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5"
            >
              <h2 className="font-display text-xl font-strong">
                {judge === 'ai' ? 'AI judge' : 'Judge'} · Ballot {index + 1}
              </h2>
              <p className="text-sm">
                {ballot.decision === 'tie'
                  ? 'Tie'
                  : ballot.decision === 'double_loss'
                    ? 'Double loss'
                    : ballot.winner
                      ? `Winner: ${subjectOf(plan, ballot.winner)?.name ?? ballot.winner}`
                      : ballot.ranking
                          ?.map(
                            (place, i) =>
                              `${i + 1}. ${place.map((key) => subjectOf(plan, key)?.name ?? key).join(' and ')}`,
                          )
                          .join('; ')}
              </p>
              <StoredBallotScores
                title="Submitted scores"
                ballot={ballot}
                plan={plan}
              />
              {ballot.reason === undefined ? null : (
                <div className="flex flex-col gap-1">
                  <h3 className="font-strong">Reason</h3>
                  <p className="text-sm whitespace-pre-wrap">{ballot.reason}</p>
                </div>
              )}
              {Object.entries(ballot.feedback ?? {}).map(([key, text]) => (
                <div key={key} className="flex flex-col gap-1">
                  <h3 className="font-strong">
                    Feedback · {subjectOf(plan, key)?.name ?? key}
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">{text}</p>
                </div>
              ))}
              {address ? (
                <p className="text-sm text-ink-muted">
                  {address.screening === 'held'
                    ? 'Contact details need review before release.'
                    : address.screening === 'pending'
                      ? 'Contact screening is pending.'
                      : 'Contact screening is complete.'}
                </p>
              ) : null}
              {action ? renderCommand(action) : null}
            </section>
          ),
        )
      )}
    </HostShell>
  );
}
