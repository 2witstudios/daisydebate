import Link from 'next/link';
import type { ReviewView } from '../../../features/train/review';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { BackLink } from '../back-link/back-link';
import { TrainCard } from '../card/train-card';
import { Meter } from '../meter/meter';
import { TrainColumns, TrainPage } from '../train-page/train-page';

const linkButton = 'no-underline hover:no-underline';

const queueMark = {
  done: 'Done',
  current: 'Now',
  todo: 'Next',
} as const;

function Queue({ view }: { readonly view: ReviewView }) {
  return (
    <TrainCard title="Today’s queue" level={3}>
      {view.queue.length === 0 ? (
        <p className="text-base text-ink-muted">Nothing is due today.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {view.queue.map((row) => (
            <li
              key={row.label}
              aria-current={row.state === 'current' ? 'step' : undefined}
              className="flex items-start justify-between gap-3 text-base"
            >
              <span
                className={cn(
                  'min-w-0',
                  row.state === 'done' ? 'text-ink-faint' : 'text-ink',
                )}
              >
                {row.label}
              </span>
              <span className="shrink-0 text-sm text-ink-muted">
                {queueMark[row.state]}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm text-ink-faint">
        {`${view.libraryTotal} saved arguments in your library, ${view.left} left to review today.`}
      </p>
    </TrainCard>
  );
}

function Recall({
  view,
}: {
  readonly view: Extract<ReviewView, { kind: 'card' }>;
}) {
  const { card } = view;
  return (
    <section
      aria-label="Review card"
      className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-1"
    >
      <div className="flex flex-col gap-2">
        <Meter value={view.progress} label="Review progress" />
        <p className="text-sm text-ink-muted">{`Card ${view.position} of ${view.count}`}</p>
      </div>
      <p className="text-sm font-strong text-ink-muted">{card.motion}</p>
      <h2 className="font-display text-2xl leading-tight font-bold text-ink">
        {card.claim}
      </h2>
      {view.revealed ? (
        <div className="flex flex-col gap-3 rounded-md bg-surface-sunken p-4 text-base text-ink">
          <p>
            <b className="font-strong">Warrant.</b> {card.warrant}
          </p>
          <p>
            <b className="font-strong">Impact.</b> {card.impact}
          </p>
        </div>
      ) : (
        <p className="text-base text-ink-muted">
          Say the warrant and the impact out loud, then check yourself.
        </p>
      )}
      {view.lastLine ? (
        <p role="status" className="text-sm text-ink-muted">
          {view.lastLine}
        </p>
      ) : null}
      {view.revealed ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-strong text-ink">
            How well did you recall it?
          </p>
          <ul className="grid grid-cols-4 gap-2 max-compact:grid-cols-2">
            {view.rate.map((rating) => (
              <li key={rating.label}>
                <Link
                  href={rating.href}
                  className={cn(
                    buttonClass('secondary'),
                    linkButton,
                    'w-full flex-col gap-1',
                  )}
                >
                  <span>{rating.label}</span>
                  <span className="text-sm font-book text-ink-muted">
                    {rating.when}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Link
            href={view.revealHref}
            className={cn(buttonClass('primary'), linkButton)}
          >
            Show the answer
          </Link>
          <Link
            href={view.editHref}
            className={cn(buttonClass('ghost'), linkButton)}
          >
            Rewrite this argument
          </Link>
        </div>
      )}
    </section>
  );
}

function Caught({
  view,
}: {
  readonly view: Extract<ReviewView, { kind: 'done' }>;
}) {
  return (
    <section
      aria-label="Review finished"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-1"
    >
      <h2 className="font-display text-2xl font-bold text-ink">
        You are caught up
      </h2>
      <p className="text-base text-ink-muted">
        {`${view.reviewed} arguments reviewed today.`} {view.nextLine}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={view.backHref}
          className={cn(buttonClass('primary'), linkButton)}
        >
          Back to Train
        </Link>
        <Link
          href={view.drillHref}
          className={cn(buttonClass('secondary'), linkButton)}
        >
          Write another argument
        </Link>
      </div>
    </section>
  );
}

function Empty({ view }: { readonly view: ReviewView }) {
  return (
    <section
      aria-label="Nothing to review"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-1"
    >
      <h2 className="font-display text-2xl font-bold text-ink">
        Nothing to review yet
      </h2>
      <p className="text-base text-ink-muted">
        Save an argument from a drill and it comes back here on a schedule that
        spaces out as you recall it.
      </p>
      <Link
        href={view.drillHref}
        className={cn(buttonClass('primary'), linkButton, 'w-fit')}
      >
        Write an argument
      </Link>
    </section>
  );
}

/** The spaced-recall review: the cue, the answer, how well you did, caught up. */
export function ReviewPage({ view }: { readonly view: ReviewView }) {
  return (
    <TrainPage>
      <BackLink href={view.backHref}>Train</BackLink>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          Review
        </h1>
        <p className="text-base text-ink-muted">
          Recall each argument from its claim, then see how you did.
        </p>
      </header>
      <TrainColumns
        asideLabel="Review queue"
        main={
          view.kind === 'card' ? (
            <Recall view={view} />
          ) : view.kind === 'done' ? (
            <Caught view={view} />
          ) : (
            <Empty view={view} />
          )
        }
        aside={<Queue view={view} />}
      />
    </TrainPage>
  );
}
