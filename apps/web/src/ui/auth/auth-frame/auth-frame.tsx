import Link from 'next/link';
import type { ReactNode } from 'react';
import { DaisyLogo, DaisyMark } from '../../components/daisy-mark/daisy-mark';

export type AuthPanelCopy = {
  readonly eyebrow: string;
  readonly title: string;
  readonly body?: ReactNode;
};

export type AuthFrameProps = {
  /** Explains the step. It never holds a control: people act on the left. */
  readonly panel: AuthPanelCopy;
  /** A reassurance line under the step; omit when the step needs none. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
};

/** Page frame shared by every sign-in step. */
export function AuthFrame({ panel, footer, children }: AuthFrameProps) {
  return (
    <div className="flex min-h-dvh gap-6 bg-background p-6 text-ink max-narrow:p-4">
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-12 px-16 pt-4 pb-8 max-reflow:px-8 max-narrow:px-0">
        <Link
          href="/"
          className="flex items-center gap-3 self-start text-ink no-underline hover:no-underline"
        >
          <DaisyLogo />
          <span className="font-display text-xl leading-shell-brand font-semibold tracking-tight">
            Daisy
          </span>
        </Link>
        <div className="flex max-w-auth-copy flex-col gap-8">{children}</div>
        {/* The slot stays when empty so the step keeps its vertical place. */}
        <div className="text-sm text-ink-muted">{footer}</div>
      </div>
      <aside className="relative isolate flex w-auth-panel shrink-0 flex-col justify-end gap-4 overflow-hidden rounded-xl bg-surface-emerald p-10 text-ink max-rail:hidden">
        <DaisyMark
          size={520}
          className="absolute -top-auth-mark-top -right-auth-mark-right -z-1 size-auth-mark text-accent opacity-20"
          discClassName="fill-gold"
        />
        <p className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          {panel.eyebrow}
        </p>
        <p className="font-display text-3xl leading-tight font-semibold tracking-tighter text-balance">
          {panel.title}
        </p>
        {panel.body === undefined ? null : (
          <div className="text-md text-ink-muted">{panel.body}</div>
        )}
      </aside>
    </div>
  );
}

export type AuthHeadingProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly children: ReactNode;
  /** Quiet eyebrow for steps that report a dead end rather than progress. */
  readonly muted?: boolean;
};

/** Eyebrow, display headline and lede at the top of a step. */
export function AuthHeading({
  eyebrow,
  title,
  children,
  muted = false,
}: AuthHeadingProps) {
  return (
    <div className="flex flex-col gap-4">
      <p
        className={
          muted
            ? 'text-xs font-bold tracking-widest text-ink-muted uppercase'
            : 'text-xs font-bold tracking-widest text-accent-strong uppercase'
        }
      >
        {eyebrow}
      </p>
      <h1 className="font-display text-auth-display leading-auth-display font-semibold tracking-auth-display text-balance max-narrow:text-3xl">
        {title}
      </h1>
      <p className="text-lg text-ink-muted">{children}</p>
    </div>
  );
}

/** Brand panel for steps whose left column needs no explanation. */
export const taglinePanel: AuthPanelCopy = {
  eyebrow: 'Competitive debate',
  title: 'Sharper minds. A brighter world.',
};
