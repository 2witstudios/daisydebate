import type { ReactNode } from 'react';

/** Term and detail pairs: a narrow label column beside the value. */
export function DetailList(props: {
  readonly rows: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {props.rows.map(([term, detail]) => (
        <div key={term} className="flex gap-4">
          <dt className="shrink-0 basis-1/4 text-ink-faint">{term}</dt>
          <dd className="min-w-0 flex-1">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
