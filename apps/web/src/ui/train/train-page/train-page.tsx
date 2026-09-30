import type { ReactNode } from 'react';

/** The page frame every Train screen shares, matching the lobby's. */
export function TrainPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      {children}
    </div>
  );
}

export type TrainColumnsProps = {
  readonly main: ReactNode;
  readonly aside: ReactNode;
  readonly asideLabel: string;
};

/** Content beside a narrow summary column; one column on the phone. */
export function TrainColumns({ main, aside, asideLabel }: TrainColumnsProps) {
  return (
    <div className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-6 max-compact:w-full max-compact:gap-4">
        {main}
      </div>
      <aside
        aria-label={asideLabel}
        className="flex w-rail shrink-0 flex-col gap-4 max-compact:w-full"
      >
        {aside}
      </aside>
    </div>
  );
}
