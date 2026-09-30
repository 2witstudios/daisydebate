import Link from 'next/link';
import type { BlockRow, CaseView } from '../../../features/prep/case-view';
import { cardDeletedInCase } from '../../../features/prep/notices';
import { IconButtonInert } from '../inert-action/icon-button-inert';
import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';
import { PrepTabs } from '../prep-tabs/prep-tabs';
import { StateAlert } from '../state-alert/state-alert';
import { TimeBar } from '../time-bar/time-bar';

const tile: Readonly<
  Record<BlockRow['kind'], { symbol: PrepIconName; cls: string }>
> = {
  brief: { symbol: 'doc', cls: 'bg-accent-soft text-accent' },
  card: { symbol: 'card', cls: 'bg-gold-soft text-gold' },
  note: { symbol: 'briefcase', cls: 'bg-surface-overlay text-ink-muted' },
};

function Row({ row }: { readonly row: BlockRow }) {
  const t = tile[row.kind];
  const title = <span className="text-base font-strong">{row.title}</span>;
  return (
    <li className="flex min-h-16 items-center gap-3 border-t border-border bg-surface-raised px-3 py-2 first:border-t-0">
      <PrepIcon
        name="grip"
        size={16}
        className="text-ink-faint max-compact:hidden"
      />
      <span className="w-4 text-sm text-ink-faint tabular-nums">
        {row.index}
      </span>
      <span
        className={`inline-flex size-avatar-md shrink-0 items-center justify-center rounded-md ${t.cls}`}
      >
        <PrepIcon name={t.symbol} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {row.href === null ? (
          title
        ) : (
          <Link href={row.href} className="no-underline hover:no-underline">
            {title}
          </Link>
        )}
        <span className="text-sm text-ink-muted">
          {row.removed ? 'Card deleted · slot kept' : row.sub}
        </span>
      </span>
      <span className="text-sm text-ink-muted tabular-nums">{row.clock}</span>
      <IconButtonInert label="Move up" symbol="arrowUp" />
      <IconButtonInert label="Move down" symbol="arrowDown" />
      <IconButtonInert label="Remove from speech" symbol="x" />
    </li>
  );
}

/** Compose: pick a speech, see its time against the limit, reorder its blocks. */
export function CaseCompose({ view }: { readonly view: CaseView }) {
  const time = view.speechTime;
  return (
    <div className="flex flex-col gap-4">
      <PrepTabs
        label="Speeches"
        current={view.speech.id}
        tabs={view.speechTabs.map((t) => ({
          id: t.id,
          label: t.label,
          href: t.href,
        }))}
      />
      {view.hasRemovedCard ? <StateAlert notice={cardDeletedInCase()} /> : null}
      <div className="rounded-lg border border-border bg-surface p-4">
        <TimeBar
          label="Reading time"
          clock={time.clock}
          budget={time.budget}
          overText={`Over [speech time] by [${time.overClock}].`}
          spareText="Within the speech time."
        />
      </div>
      <ul
        aria-label={`${view.speech.label} blocks`}
        className="overflow-hidden rounded-lg border border-border"
      >
        {view.blocks.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>
      <p className="text-xs text-ink-faint">
        Use the arrows to reorder. Each block is a live link: editing the brief
        updates it here until you save a version.
      </p>
    </div>
  );
}
