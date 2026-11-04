import type { ReactNode } from 'react';

/** The document manager as one section of a longer page, such as a Round's end. */
export function BoundedDocuments({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-3 px-6 pb-8">
      <div className="flex room-workspace flex-col border-t border-border">
        {children}
      </div>
    </div>
  );
}
