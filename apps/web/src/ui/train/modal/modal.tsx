import type { ReactNode } from 'react';

export type ModalProps = {
  readonly label: string;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
};

/**
 * A confirmation over the screen. It is ordinary markup, so a step that
 * needs one can render it from the URL with no script.
 */
export function Modal({ label, title, children, actions }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex w-full max-w-search flex-col gap-4 rounded-lg border border-border bg-surface-raised p-6 shadow-3"
      >
        <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
        {children ? (
          <p className="text-base text-ink-muted">{children}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">{actions}</div>
      </div>
    </div>
  );
}
