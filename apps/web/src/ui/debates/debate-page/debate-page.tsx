import Link from 'next/link';
import type { DebateView, TimelineRow } from '../../../features/debates/view';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { DemoControls } from '../../components/demo-controls/demo-controls';
import { Notice } from '../../components/notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import { cn } from '../../cn';

const linkButton = 'no-underline hover:no-underline';

const winnerText = {
  affirmative: 'Affirmative wins',
  negative: 'Negative wins',
  draw: 'A draw',
} as const;
const panel = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const shell =
  'mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4';

const sideLabel = {
  affirmative: 'Affirmative',
  negative: 'Negative',
  both: 'Both sides',
} as const;

const mark = { done: 'Done', now: 'Now', next: 'Next' } as const;

function Timeline({ rows }: { readonly rows: readonly TimelineRow[] }) {
  return (
    <section
      aria-label="Turns"
      className="flex flex-col gap-3 rounded-xl bg-surface p-5 shadow-1"
    >
      <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Turns
      </h2>
      <ol className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.label}
            aria-current={row.state === 'now' ? 'step' : undefined}
            className="flex items-center justify-between gap-3 text-base"
          >
            <span
              className={cn(
                row.state === 'done' && 'text-ink-faint',
                row.state === 'now' && 'font-strong text-ink',
                row.state === 'next' && 'text-ink-muted',
              )}
            >
              {row.label}
            </span>
            <span className="shrink-0 text-sm text-ink-muted">
              {`${row.length} · ${mark[row.state]}`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Body({
  view,
}: {
  readonly view: Exclude<DebateView, { kind: 'denied' }>;
}) {
  if (view.kind === 'live')
    return (
      <section aria-label="Current turn" className={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="live">Live</Badge>
          <Badge tone="neutral">{sideLabel[view.now.side]}</Badge>
          {view.now.yours ? <Badge tone="accent">Your turn</Badge> : null}
        </div>
        <h2 className="font-display text-2xl leading-tight font-bold text-ink">
          {view.now.label}
        </h2>
        <p
          role="timer"
          aria-label={`${view.now.remaining} left`}
          className="font-display text-display leading-none font-bold text-ink tabular-nums max-compact:text-display-sm"
        >
          {view.now.remaining}
        </p>
        <p className="text-base text-ink-muted">
          {view.next ?? 'This is the last turn.'}
        </p>
      </section>
    );
  if (view.kind === 'awaiting')
    return (
      <section aria-label="Awaiting the ruling" className={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="gold">
            {view.judge === 'ai'
              ? 'Ready for the AI judge'
              : 'Awaiting the judge’s ballot'}
          </Badge>
        </div>
        <h2 className="font-display text-2xl leading-tight font-bold text-ink">
          The speaking is over
        </h2>
        <p className="text-base text-ink-muted">{view.note}</p>
        {view.action ? (
          <Link
            href={view.action.href}
            className={cn(buttonClass('primary'), linkButton, 'w-fit')}
          >
            {view.action.label}
          </Link>
        ) : null}
      </section>
    );
  return <Result view={view} />;
}

type Completed = Extract<DebateView, { kind: 'completed' }>;

function Result({ view }: { readonly view: Completed }) {
  return (
    <section aria-label="Result" className={panel}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Completed</Badge>
        {view.by === 'ai' ? (
          <Badge tone="gold">Placeholder AI ruling</Badge>
        ) : null}
      </div>
      <h2 className="font-display text-3xl leading-tight font-bold text-ink">
        {winnerText[view.winner]}
      </h2>
      <p className="text-base text-ink-muted">{view.reason}</p>
      <div className="flex flex-wrap gap-3">
        {view.rematchHref ? (
          <Link
            href={view.rematchHref}
            className={cn(buttonClass('primary'), linkButton)}
          >
            Rematch
          </Link>
        ) : null}
        <Link
          href={view.roomHref ?? '/debates'}
          className={cn(
            buttonClass(view.rematchHref ? 'secondary' : 'primary'),
            linkButton,
          )}
        >
          {view.roomHref ? 'Back to the room' : 'My debates'}
        </Link>
      </div>
    </section>
  );
}

/**
 * The debate: the current turn and its clock, what comes next, and, once the
 * speaking is over, the ruling. Every control is a link to the next state.
 */
export function DebatePage({ view }: { readonly view: DebateView }) {
  if (view.kind === 'denied')
    return (
      <div className={shell}>
        <PageHeader title="You are not in this debate" />
        <Notice
          tone="neutral"
          icon="eye"
          title="Only the people in it can open it"
        >
          Debates you can watch are on the Watch page.
        </Notice>
        <Link
          href="/watch"
          className={cn(buttonClass('primary'), linkButton, 'w-fit')}
        >
          Watch debates
        </Link>
      </div>
    );
  return (
    <div className={shell}>
      <Link
        href={view.roomHref ?? '/debates'}
        className="inline-flex min-h-10 w-fit items-center gap-2 text-base font-strong text-ink-muted no-underline hover:text-ink hover:no-underline"
      >
        <span aria-hidden="true">&lsaquo;</span>
        {view.roomHref ? 'The room' : 'My debates'}
      </Link>
      <PageHeader title={view.title} />
      <div className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-6 max-compact:w-full max-compact:gap-4">
          <Body view={view} />
        </div>
        <aside
          aria-label="About this debate"
          className="flex w-rail shrink-0 flex-col gap-4 max-compact:w-full"
        >
          <Timeline rows={view.timeline} />
          <DemoControls
            blurb="This debate has no backend clock. These step through its turns."
            items={view.demo}
          />
        </aside>
      </div>
    </div>
  );
}
