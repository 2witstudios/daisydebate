import type { ReactNode } from 'react';

/** The page frame Train's landing shares with the lobby's. */
export function TrainPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      {children}
    </div>
  );
}
