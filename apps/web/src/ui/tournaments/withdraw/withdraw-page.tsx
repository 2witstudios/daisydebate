import type { WithdrawScreen } from '../../../features/tournaments/withdraw';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import type { Tournament } from '../../../features/tournaments/tournament';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { InertAction } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';

import { PageFrame } from '../page-frame/page-frame';

type Copy = {
  readonly title: string;
  readonly body: string | null;
  readonly confirm: 'withdraw' | 'withdrawLate' | 'leaveWaitlist' | null;
  readonly reason: boolean;
  readonly keep: string;
};

function copyFor(screen: WithdrawScreen, tournament: Tournament): Copy {
  switch (screen.kind) {
    case 'before-bracket':
      return {
        title: `Withdraw from ${tournament.name}?`,
        body: 'Your place goes to the next person on the waitlist.',
        confirm: 'withdraw',
        reason: false,
        keep: 'Keep my place',
      };
    case 'leave-waitlist':
      return {
        title: `Leave the waitlist of ${tournament.name}?`,
        body: `You give up position ${screen.position}.`,
        confirm: 'leaveWaitlist',
        reason: false,
        keep: 'Stay on the waitlist',
      };
    case 'after-bracket':
      return {
        title: 'Withdraw after the bracket is out?',
        body: `${screen.opponent ? `@${screen.opponent} gets a bye in round 1` : 'Your round 1 opponent gets a bye'}. Late withdrawals are recorded in the tournament log.`,
        confirm: 'withdrawLate',
        reason: true,
        keep: 'Keep my place',
      };
    case 'not-entered':
      return {
        title: `You are not entered in ${tournament.name}`,
        body: null,
        confirm: null,
        reason: false,
        keep: 'Back to the tournament',
      };
  }
}

/** Leaving a tournament: what it costs, and the one confirming action. */
export function WithdrawPage({
  screen,
  tournament,
}: {
  readonly screen: WithdrawScreen;
  readonly tournament: Tournament;
}) {
  const copy = copyFor(screen, tournament);
  return (
    <PageFrame>
      <Breadcrumb
        trail={[
          { label: 'Tournaments', href: tournamentRoutes.index },
          {
            label: tournament.name,
            href: tournamentRoutes.detail(tournament.id),
          },
          { label: 'Withdraw' },
        ]}
      />
      <section
        aria-labelledby="withdraw-title"
        className="flex max-w-prose flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
      >
        <h1
          id="withdraw-title"
          className="font-display text-2xl leading-tight font-bold tracking-tight"
        >
          {copy.title}
        </h1>
        {copy.body ? (
          <p className="text-base text-ink-muted">{copy.body}</p>
        ) : null}
        {copy.reason ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="reason" className="text-base font-strong text-ink">
              Reason (optional, organizer only)
            </label>
            <input
              id="reason"
              type="text"
              placeholder="For example: illness"
              className="h-10 rounded-md border border-border bg-surface-raised px-3 text-base text-ink"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {copy.confirm ? (
            <InertAction id={copy.confirm} variant="primary" />
          ) : null}
          <LinkButton href={tournamentRoutes.detail(tournament.id)}>
            {copy.keep}
          </LinkButton>
        </div>
      </section>
    </PageFrame>
  );
}
