'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '../icon/icon';

/**
 * The panel's second action: somewhere else to go, a dialog on this page to
 * open (named by its title id), or simply "Not now".
 */
export type UpgradeAlternative =
  | { readonly kind: 'link'; readonly label: string; readonly href: string }
  | { readonly kind: 'dialog'; readonly label: string; readonly titleId: string }
  | { readonly kind: 'dismiss'; readonly label: string };

const openDialog = (titleId: string) =>
  document
    .querySelector<HTMLDialogElement>(`dialog[aria-labelledby="${titleId}"]`)
    ?.showModal();

const action =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border px-3.5 text-sm leading-tight font-strong whitespace-nowrap transition-colors duration-120 ease-standard';
const primary = `${action} border-transparent bg-accent text-accent-ink hover:bg-accent-strong`;
const quiet = `${action} cursor-pointer border-transparent bg-transparent text-ink hover:bg-accent-soft`;

/**
 * A free account's upgrade moment (PYL-11): small, in place, and shown only
 * when the account reaches for the thing. It never shows a count.
 */
export function UpgradePanel({
  title,
  children,
  alternative,
  premiumHref = '/premium',
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly alternative: UpgradeAlternative;
  readonly premiumHref?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-border-strong bg-surface-raised px-[18px] py-4"
    >
      <div className="flex items-start gap-2.5">
        <Icon name="sparkle" size={20} className="mt-0.5 shrink-0 text-gold" />
        <div className="flex min-w-0 flex-col gap-1">
          <strong className="font-strong text-ink">{title}</strong>
          <span className="text-sm text-ink-muted">{children}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <a href={premiumHref} className={primary}>
          Get Premium
        </a>
        {alternative.kind === 'link' ? (
          <a href={alternative.href} className={quiet}>
            {alternative.label}
          </a>
        ) : (
          <button
            type="button"
            className={quiet}
            onClick={() =>
              alternative.kind === 'dialog'
                ? openDialog(alternative.titleId)
                : setDismissed(true)
            }
          >
            {alternative.label}
          </button>
        )}
      </div>
    </div>
  );
}
