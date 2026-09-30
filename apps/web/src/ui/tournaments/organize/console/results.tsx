import type { ConsoleView } from '../../../../features/tournaments/console-view';
import { buttonClass } from '../../../components/button/button-class';
import { Badge } from '../../../components/badge/badge';
import { StatusLine } from '../../../components/status-line/status-line';
import { DisabledAction } from '../../inert-action/inert-action';
import { LinkButton } from '../../link-button/link-button';
import { Notice } from '../../notice/notice';
import { tournamentRoutes } from '../../../../features/tournaments/routes';
import { Person } from '../../person/person';
import { Icon } from '../../../components/icon/icon';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const h2 = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

export function ResultsTab({ view }: { readonly view: ConsoleView }) {
  if (view.results.length === 0)
    return (
      <section className={card}>
        <p className="text-base text-ink-muted">
          No results yet. Results appear here once debates start, and ballots
          arrive by themselves.
        </p>
      </section>
    );
  const { enterResult } = view;
  return (
    <div className="flex flex-col gap-4">
      <section
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
        aria-label="Results"
      >
        <ul>
          {view.results.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0"
            >
              <span className="text-sm text-ink-faint">{row.id}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-strong text-ink">
                  {row.matchup}
                </span>
                <span className="text-sm text-ink-muted">{row.detail}</span>
              </span>
              <span className="flex items-center gap-2 text-sm">
                {row.live ? (
                  <StatusLine tone="live">{row.status}</StatusLine>
                ) : (
                  <Badge
                    tone={row.status === 'Needs result' ? 'gold' : 'neutral'}
                  >
                    {row.status}
                  </Badge>
                )}
                {row.status === 'Ballot in' ? (
                  <DisabledAction
                    label="Correct"
                    reason="Corrections need the organizer service."
                    variant="ghost"
                  />
                ) : null}
                {row.status === 'Forfeit to confirm' ? (
                  <DisabledAction
                    label="Confirm"
                    reason="Confirming needs the organizer service."
                    variant="ghost"
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {enterResult ? (
        <section
          className={card}
          aria-label={`Enter result for ${enterResult.debate}`}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-md font-strong text-ink">{`Enter result for ${enterResult.debate}`}</h2>
            <Badge>Audit logged</Badge>
          </div>
          <p className="text-base text-ink-muted">
            {`@${enterResult.a} vs @${enterResult.b}. The judge disconnected before submitting a ballot. Enter the result from the room record, with a reason. Both debaters and the tournament log see it.`}
          </p>
          <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
            <label className="flex flex-col gap-2 text-base font-strong text-ink">
              Winner
              <select
                disabled
                className="h-10 rounded-md border border-border bg-surface-raised px-3 text-base font-book text-ink disabled:opacity-60"
              >
                <option>{`Affirmative, @${enterResult.a}`}</option>
                <option>{`Negative, @${enterResult.b}`}</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-base font-strong text-ink">
              Reason (required)
              <input
                disabled
                placeholder="Why you are entering this result"
                className="h-10 rounded-md border border-border bg-surface-raised px-3 text-base font-book text-ink disabled:opacity-60"
              />
            </label>
          </div>
          <p className="text-sm text-ink-faint">
            Entering results needs the organizer service, so this form is off
            for now.
          </p>
          <div className="flex justify-end gap-3">
            <DisabledAction
              label="Save result"
              reason="Saving needs the organizer service."
              variant="primary"
            />
          </div>
        </section>
      ) : null}
      <section className={card}>
        <h2 className={h2}>Tournament log</h2>
        <ul>
          {view.data.log.map((entry) => (
            <li
              key={entry.at}
              className="flex gap-3 border-t border-border py-2 text-base first:border-t-0"
            >
              <span className="text-sm text-ink-faint tabular-nums">
                {entry.at}
              </span>
              <span className="text-ink-muted">{entry.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ModerationTab({ view }: { readonly view: ConsoleView }) {
  const { report } = view.data;
  const reportActions = [
    'Dismiss',
    'Warn',
    'Forfeit the round',
    'Disqualify',
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      {report && view.state === 'running' ? (
        <section
          className={card}
          aria-label={`Conduct report on ${report.debate}`}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-md font-strong text-ink">{`Conduct report on ${report.debate}`}</h2>
            <Badge tone="gold">Open</Badge>
          </div>
          <p className="text-base text-ink-muted">
            {`Reported by @${report.by}. The report text appears here, quoting the flagged message. Reporter and reported are hidden from each other until you decide.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {reportActions.map((label) => (
              <DisabledAction
                key={label}
                label={label}
                reason="Decisions need the organizer service."
                variant="ghost"
              />
            ))}
          </div>
        </section>
      ) : null}
      {view.forfeit ? (
        <section
          className={card}
          aria-label={`Forfeit requested on ${view.forfeit.id}`}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-md font-strong text-ink">{`Forfeit requested on ${view.forfeit.id}`}</h2>
            <Badge tone="gold">Needs a decision</Badge>
          </div>
          <p className="text-base text-ink-muted">{`${view.forfeit.detail} Confirming advances the other debater.`}</p>
          <div className="flex flex-wrap gap-2">
            <DisabledAction
              label="Confirm forfeit"
              reason="Confirming needs the organizer service."
              variant="ghost"
            />
            <DisabledAction
              label="Give them 5 more minutes"
              reason="Extensions need the organizer service."
              variant="ghost"
            />
          </div>
        </section>
      ) : null}
      {view.state !== 'running' ? (
        <section className={card}>
          <p className="text-base text-ink-muted">
            No reports or forfeit requests yet. They appear here once debates
            start.
          </p>
        </section>
      ) : null}
      <section className={card}>
        <h2 className={h2}>Moderators</h2>
        <ul>
          {view.data.moderators.map((moderator) => (
            <li
              key={moderator.handle}
              className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0"
            >
              <Person handle={moderator.handle} />
              <span className="text-sm text-ink-muted">{moderator.state}</span>
            </li>
          ))}
        </ul>
        <div>
          <DisabledAction
            label="Invite moderator"
            reason="Inviting needs the organizer service."
          />
        </div>
      </section>
      <p className="text-sm text-ink-faint">
        Moderators can dismiss, warn and record forfeits. Disqualifying,
        correcting a published result and publishing are organizer-only. Every
        action is logged with who took it.
      </p>
    </div>
  );
}

export function PublishTab({ view }: { readonly view: ConsoleView }) {
  const { publish } = view;
  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <h2 className="text-md font-strong text-ink">
          Before you can publish results
        </h2>
        <ul className="flex flex-col gap-2 text-base text-ink-muted">
          {publish.items.map((item) => (
            <li key={item.text} className="flex items-start gap-2">
              <span className={item.ok ? 'text-accent' : 'text-gold'}>
                <Icon
                  name={item.ok ? 'check' : 'alert'}
                  size={16}
                  label={item.ok ? 'Done' : 'Not done'}
                />
              </span>
              {item.text}
            </li>
          ))}
        </ul>
      </section>
      <Notice icon="trophy">
        Publishing puts the final standings on the public results page, awards
        the champion, runner-up and semifinalist honours, and makes a
        certificate for every placed entrant. A published result can only be
        changed by an organizer with a reason, and the change is shown as an
        amended result.
      </Notice>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className={buttonClass('primary')}
        >
          Publish results
        </button>
        <LinkButton href={tournamentRoutes.results(view.data.tournament.id)}>
          Preview the results page
        </LinkButton>
      </div>
    </div>
  );
}
