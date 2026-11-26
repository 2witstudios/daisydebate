import type { ReactNode } from 'react';
import { buttonClass } from '../components/button/button-class';

/**
 * The frame every audience page shares (`/ncfca`, `/parents`, `/coach`,
 * `/leagues`, `/tab`): a title and lede with the page's actions, sections of
 * running prose, and a closing panel. Each page is written for one reader.
 */
export function AudiencePage({
  title,
  lede,
  actions,
  children,
}: {
  readonly title: string;
  readonly lede: string;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-12 px-6 pt-5 pb-12 max-compact:gap-8 max-narrow:px-4">
      <header className="flex max-w-reading flex-col gap-4">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tighter text-balance">
          {title}
        </h1>
        <p className="text-md leading-normal text-ink-muted">{lede}</p>
        <div className="flex flex-wrap gap-3">{actions}</div>
      </header>
      {children}
    </div>
  );
}

/** One part of the page's case: a heading and what follows from it. */
export function Story({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex max-w-reading flex-col gap-3 text-base leading-normal text-ink-muted"
    >
      <h2 id={id} className="font-display text-2xl font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The page's last word: its action again, in a raised panel. */
export function Closing({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-8 max-narrow:p-5"
    >
      <h2 id={id} className="font-display text-2xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A figure with its caption beneath, for the page's one picture. */
export function Picture({
  caption,
  children,
}: {
  readonly caption: string;
  readonly children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-3">
      {children}
      <figcaption className="text-sm text-ink-muted">{caption}</figcaption>
    </figure>
  );
}

/** A link drawn as the page's main action, or left out when its release is closed. */
export function Action({
  href,
  variant = 'primary',
  children,
}: {
  readonly href: string | null;
  readonly variant?: 'primary' | 'secondary';
  readonly children: ReactNode;
}) {
  return href === null ? null : (
    <a href={href} className={buttonClass(variant)}>
      {children}
    </a>
  );
}

/** A link inside prose, or nothing when its release is closed. */
export function TextLink({
  href,
  children,
}: {
  readonly href: string | null;
  readonly children: ReactNode;
}) {
  return href === null ? null : (
    <a href={href} className="font-strong text-ink">
      {children}
    </a>
  );
}

/** Daisy is in beta: said once, plainly, wherever a page asks for a sign-up. */
export function BetaLine() {
  return (
    <p className="text-sm text-ink-muted">
      Daisy is in beta. A new account is approved before its first round.
    </p>
  );
}
