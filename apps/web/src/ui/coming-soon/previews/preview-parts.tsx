import type { ReactNode } from 'react';
import type { PreviewRowData } from '../../mock/coming-soon';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';

/** The page title and lede at the top of every preview. */
export function PreviewHeader({
  title,
  lede,
  actions,
}: {
  readonly title: string;
  readonly lede: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-display text-2xl font-semibold tracking-tight text-ink">
          {title}
        </p>
        <p className="text-base text-ink-muted">{lede}</p>
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** A list of sample rows: optional avatar, title, detail, tag and trailing text. */
export function PreviewRows({
  rows,
}: {
  readonly rows: readonly PreviewRowData[];
}) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-3">
          {row.who ? <Avatar name={row.who} size="sm" nameVisible /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-md font-strong text-ink">{row.title}</span>
            {row.detail ? (
              <span className="text-sm text-ink-muted">{row.detail}</span>
            ) : null}
          </div>
          {row.tag ? <Badge tone={row.tag.tone}>{row.tag.text}</Badge> : null}
          {row.trailing ? (
            <span className="text-sm whitespace-nowrap text-ink-muted tabular-nums">
              {row.trailing}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The sample content's outer stack, shared so every preview spaces alike. */
export function PreviewPage({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-4 p-6">{children}</div>;
}
