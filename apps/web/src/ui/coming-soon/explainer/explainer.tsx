import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Destination } from '../../../features/coming-soon/destinations';
import type { NotifyAction } from '../../../features/coming-soon/notify';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { SampleAction } from '../../components/sample-action/sample-action';
import { cn } from '../../cn';
import { destinationGlyph } from '../destination-glyph';
import { PreviewFrame } from '../preview-frame/preview-frame';

export type ExplainerProps = {
  readonly destination: Destination;
  readonly notify: NotifyAction;
  /** The scaled, non-interactive picture of the finished page. */
  readonly preview: ReactNode;
};

const linkButton = 'no-underline hover:no-underline';

/**
 * The public "coming soon" page for one destination: its name, a preview of
 * the finished page, and the two ways out.
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
        <section
          aria-labelledby={`${notifyId}-title`}
          className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
        >
          <h2 id={`${notifyId}-title`} className="text-md font-strong text-ink">
            {destination.title} is not open yet
          </h2>
          <div className="flex flex-wrap gap-3">
            {notify.kind === 'sign-in' ? (
              <Link
                href={notify.href}
                className={cn(buttonClass('primary'), linkButton)}
              >
                Get notified
              </Link>
            ) : (
              <SampleAction
                label="Get notified"
                className={cn(buttonClass('primary'), linkButton)}
              >
                Get notified
              </SampleAction>
            )}
            <Link href="/" className={cn(buttonClass('secondary'), linkButton)}>
              Back to home
            </Link>
          </div>
        </section>
        <PreviewFrame>{preview}</PreviewFrame>
      </div>
    </article>
  );
}
