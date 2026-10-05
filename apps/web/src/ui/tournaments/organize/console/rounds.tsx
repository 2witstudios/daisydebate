import type { ConsoleView } from '../../../../features/tournaments/console-view';
import { Icon } from '../../../components/icon/icon';
import { buttonClass } from '../../../components/button/button-class';
import { SampleButton } from '../../inert-action/inert-action';
import { LinkButton } from '../../link-button/link-button';
import { Notice } from '../../notice/notice';
import { Person } from '../../person/person';
import { cn } from '../../../cn';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';

export function EntrantsTab({ view }: { readonly view: ConsoleView }) {
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-md font-strong text-ink">{view.entrantsHeading}</h2>
        <span className="flex gap-2">
          <SampleButton label="Invite entrant" variant="ghost" />
          <SampleButton label="Export list" variant="ghost" />
        </span>
      </div>
      <ul>
        {view.entrantsShown.map((entrant) => (
          <li
            key={entrant.handle}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-2 first:border-t-0"
          >
            <span className="flex items-center gap-3">
              <span className="w-6 text-sm text-ink-faint tabular-nums">
                {entrant.seed}
              </span>
              <Person handle={entrant.handle} />
            </span>
            <span className="text-sm text-ink-muted tabular-nums">
              {entrant.rating}
            </span>
            <span className="text-sm text-ink-muted">{entrant.status}</span>
            <span className="flex gap-1">
              <SampleButton label="Remove" variant="ghost" />
              <SampleButton label="Disqualify" variant="ghost" />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-faint">{view.entrantsNote}</p>
    </section>
  );
}

export function RoundsTab({ view }: { readonly view: ConsoleView }) {
  const { pairings, judges } = view;
  return (
    <div className="flex flex-col gap-4">
      <section className={card} aria-label="Prepare the round">
        <ol className="flex flex-wrap gap-3">
          {view.steps.map((step) => (
            <li key={step.n} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex size-6 items-center justify-center rounded-round border border-border-strong text-xs font-bold text-ink-muted"
              >
                {step.n}
              </span>
              {step.enabled ? (
                <LinkButton href={step.href} variant="primary">
                  {step.label}
                </LinkButton>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className={buttonClass('secondary')}
                >
                  {step.label}
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section
        aria-label="Pairings"
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
      >
        {pairings ? (
          <>
            <div
              className="grid grid-cols-12 gap-x-3 px-4 py-3 text-2xs font-bold tracking-wider text-ink-faint uppercase max-compact:hidden"
              aria-hidden="true"
            >
              <span className="col-span-1">Debate</span>
              <span className="col-span-5">Affirmative vs Negative (seed)</span>
              <span className="col-span-2">Room</span>
              <span className="col-span-2">Judge</span>
              <span className="col-span-2">Conflicts</span>
            </div>
            <ul>
              {pairings.debates.map((debate) => {
                const judge = judges?.find((item) => item.debate === debate.id);
                return (
                  <li
                    key={debate.id}
                    className="grid grid-cols-12 items-center gap-x-3 gap-y-1 border-t border-border px-4 py-3 text-base"
                  >
                    <span className="col-span-1 text-ink-faint max-compact:col-span-3">
                      {debate.id}
                    </span>
                    <span className="col-span-5 text-ink max-compact:col-span-9">
                      {`@${debate.a.handle} `}
                      <span className="text-ink-faint">{`(${debate.a.seed})`}</span>
                      {` vs @${debate.b.handle} `}
                      <span className="text-ink-faint">{`(${debate.b.seed})`}</span>
                    </span>
                    <span className="col-span-2 text-ink-muted max-compact:col-span-4">
                      {debate.room}
                    </span>
                    <span className="col-span-2 text-ink-muted max-compact:col-span-4">
                      {judge ? `@${judge.judge}` : 'Not assigned'}
                    </span>
                    <span
                      className={cn(
                        'col-span-2 text-sm max-compact:col-span-4',
                        judge?.conflict === 'Reassigned'
                          ? 'font-strong text-gold'
                          : 'text-ink-muted',
                      )}
                    >
                      {judge ? judge.conflict : 'Not checked'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-border px-4 py-3 text-sm text-ink-muted">
              {pairings.byes.length > 0
                ? `Byes: ${pairings.byes.map((entrant) => `@${entrant.handle}`).join(', ')}`
                : 'No byes'}
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
            <span className="text-ink-faint">
              <Icon name="swords" size={28} />
            </span>
            <p className="text-md font-strong text-ink">No pairings yet</p>
          </div>
        )}
      </section>
      <Notice icon="gavel">{`${view.data.volunteers} volunteer judges`}</Notice>
    </div>
  );
}
