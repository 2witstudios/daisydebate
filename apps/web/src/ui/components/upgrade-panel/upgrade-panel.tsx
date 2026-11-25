'use client';

import { Button } from '../button/button';
import { requestDialog } from '../dialog/dialog';
import { buttonClass } from '../button/button-class';
import { Announcement } from '../announcement/announcement';
import { useState, type ReactNode } from 'react';
import { PremiumMark } from '../premium-mark/premium-mark';

/**
 * The panel's second action: somewhere else to go, a dialog on this page to
 * open (named by its title id), or simply "Not now".
 */
export type UpgradeAlternative =
  | { readonly kind: 'link'; readonly label: string; readonly href: string }
  | {
      readonly kind: 'dialog';
      readonly label: string;
      readonly titleId: string;
    }
  | { readonly kind: 'dismiss'; readonly label: string };

const primary = buttonClass('primary', 'room');
const quiet = buttonClass('ghost', 'room');

/**
 * A free account's upgrade moment (PYL-11): small, in place, and shown only
 * when the account reaches for the thing. It never shows a count. A screen
 * shows one panel; a second Premium limit on it is an `UpgradeLine`.
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
    <Announcement
      as="div"
      kind="progress"
      className="flex flex-col gap-3 rounded-xl border border-border-strong bg-surface-raised px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <PremiumMark size={20} />
        <div className="flex min-w-0 flex-col gap-1">
          <strong className="font-strong text-ink">{title}</strong>
          <span className="text-sm text-ink-muted">{children}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <a href={premiumHref} className={primary}>
          Get Premium
        </a>
        {alternative.kind === 'link' ? (
          <a href={alternative.href} className={quiet}>
            {alternative.label}
          </a>
        ) : (
          <Button
            variant="ghost"
            size="room"
            type="button"
            onClick={() =>
              alternative.kind === 'dialog'
                ? requestDialog(alternative.titleId)
                : setDismissed(true)
            }
          >
            {alternative.label}
          </Button>
        )}
      </div>
    </Announcement>
  );
}

/**
 * A second Premium limit on a screen that already shows a panel: the same
 * fact as a plain sentence and a link, with no mark and no second button.
 */
export function UpgradeLine({
  children,
  premiumHref = '/premium',
}: {
  readonly children: ReactNode;
  readonly premiumHref?: string;
}) {
  return (
    <Announcement as="p" kind="progress" className="text-sm text-ink-muted">
      {children}{' '}
      <a href={premiumHref} className="font-strong text-ink underline">
        See Premium
      </a>
    </Announcement>
  );
}
