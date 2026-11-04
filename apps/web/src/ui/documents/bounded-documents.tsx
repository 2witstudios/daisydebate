import type { ReactNode } from 'react';

/** The document manager as one section of a longer page, such as a Round's end. */
export function BoundedDocuments({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-3 px-6 pb-8">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="flex room-workspace flex-col border-t border-border">
        {children}
      </div>
    </div>
  );
}
