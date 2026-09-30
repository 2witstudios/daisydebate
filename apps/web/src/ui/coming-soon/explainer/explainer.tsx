import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Destination } from '../../../features/coming-soon/destinations';
import type { NotifyAction } from '../../../features/coming-soon/notify';
import { Badge } from '../../components/badge/badge';
import { Button } from '../../components/button/button';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { destinationGlyph } from '../destination-glyph';
import { PreviewFrame } from '../preview-frame/preview-frame';

export type ExplainerProps = {
  readonly destination: Destination;
  readonly notify: NotifyAction;
  /** The scaled, non-interactive picture of the finished page. */
  readonly preview: ReactNode;
};

const eyebrow = 'text-xs font-bold tracking-widest text-ink-muted uppercase';
const linkButton = 'no-underline hover:no-underline';

/**
 * The public "coming soon" page for one destination: what it is, how it will
 * work, what you will be able to do, a preview of the finished page, and the
 * two ways out. Pure presentation over a destination's copy.
 */
export function Explainer({ destination, notify, preview }: ExplainerProps) {
  const { glyph, tint } = destinationGlyph[destination.slug];
  const notifyId = `notify-${destination.slug}`;
  return (
    <article className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 self-start text-sm text-ink-muted no-underline hover:text-ink hover:no-underline"
      >
        <span aria-hidden="true">‹</span> Home
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Icon
            name={glyph}
            size={28}
            strokeWidth={1.6}
            className={tint === 'gold' ? 'text-gold' : 'text-accent'}
          />
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink max-tiles:text-2xl">
            {destination.title}
          </h1>
          <Badge tone="accent">Coming soon</Badge>
        </div>
        <p className="text-lg text-ink-muted">{destination.tagline}</p>
      </header>
      <div className="grid grid-cols-2 items-start gap-8 max-compact:grid-cols-1">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className={eyebrow}>What it is</h2>
            <p className="text-base leading-normal text-ink">
              {destination.what}
            </p>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className={eyebrow}>How it will work</h2>
            <ol className="flex list-none flex-col gap-3">
              {destination.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-round bg-accent-soft text-sm font-strong text-accent"
                  >
                    {index + 1}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-base font-strong text-ink">
                      {step.title}
                    </span>
                    <span className="text-sm text-ink-muted">{step.body}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className={eyebrow}>What you will be able to do</h2>
            <ul className="flex list-none flex-col gap-2">
              {destination.abilities.map((ability) => (
                <li
                  key={ability}
                  className="flex items-center gap-2 text-base text-ink"
                >
                  <Icon name="check" size={16} className="text-accent" />
                  {ability}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <PreviewFrame>{preview}</PreviewFrame>
      </div>
      <section
        aria-labelledby={`${notifyId}-title`}
        className="flex items-center justify-between gap-4 rounded-xl bg-surface p-6 shadow-1 max-compact:flex-col max-compact:items-start"
      >
        <div className="flex flex-col gap-1">
          <h2 id={`${notifyId}-title`} className="text-md font-strong text-ink">
            {destination.title} is not open yet
          </h2>
          <p className="text-sm text-ink-muted">
            Daisy Debate is opening in stages. Sign in to be told when{' '}
            {destination.title} opens.
          </p>
          {notify.kind === 'inert' ? (
            <p id={notifyId} className="text-sm text-ink-faint">
              {notify.reason}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          {notify.kind === 'sign-in' ? (
            <Link
              href={notify.href}
              className={cn(buttonClass('primary'), linkButton)}
            >
              Get notified
            </Link>
          ) : (
            <Button disabled aria-describedby={notifyId}>
              Get notified
            </Button>
          )}
          <Link href="/" className={cn(buttonClass('secondary'), linkButton)}>
            Back to home
          </Link>
        </div>
      </section>
    </article>
  );
}
