import type { ReactNode } from 'react';

/**
 * The narrow column and card every Ranked screen sits in: the destination is
 * deliberately lean, one card at a time.
 */
export function RankedCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-auth-panel flex-col px-4 pt-6 pb-8">
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-10 shadow-1 max-compact:p-6">
        {children}
      </section>
    </div>
  );
}

/** The card's heading voice: a display-sized title for a step. */
export const cardTitleClass =
  'font-display leading-tight font-bold tracking-tight';
