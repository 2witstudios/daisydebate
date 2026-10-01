import Link from 'next/link';
import type { RoomPanelView } from '../../../features/prep/room-panel';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { PrepIcon } from '../prep-icon/prep-icon';
import { RoomPanel } from '../room-panel/room-panel';
import { scrimClass } from '../room-panel/room-panel-class';

export type InDebatePageProps = {
  readonly view: RoomPanelView;
  readonly loadedAt: string;
};

/**
 * A live room with your prep panel beside it. The room itself is built with
 * the rooms: this page shows only enough of it (sample names, a sample
 * timer) to place the panel, which is yours alone.
 */
export function InDebatePage({ view, loadedAt }: InDebatePageProps) {
  const { query } = view;
  return (
    <div className="mx-auto flex w-full max-w-dash-column max-compact:flex-col">
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl leading-tight font-bold tracking-tight">
            Ranked table, serious only
          </h1>
          <Badge tone="gold">Ranked</Badge>
          <span className="ml-auto text-sm text-ink-muted">14 watching</span>
          {query.hidden ? (
            <Link
              href={view.showHref}
              className={`${buttonClass('secondary')} no-underline hover:no-underline`}
            >
              <PrepIcon name="doc" size={18} />
              Show prep
            </Link>
          ) : null}
        </header>
        <section
          aria-label="Your speech"
          className="flex flex-col gap-3 rounded-xl bg-surface-stage p-6 text-stage-ink"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="flex flex-col">
              <span className="text-sm font-strong text-stage-ink-muted">
                Your speech
              </span>
              <span className="font-display text-xl font-bold">[Speech 1]</span>
            </p>
            <p className="flex flex-col items-end">
              <span className="font-display text-3xl font-bold tabular-nums">
                0:00
              </span>
              <span className="text-sm text-stage-ink-muted">
                of [speech time]
              </span>
            </p>
          </div>
        </section>
        <ul className="grid grid-cols-2 gap-3 max-compact:grid-cols-1">
          <li className="flex items-center justify-between rounded-lg bg-surface p-4 shadow-1">
            <span className="flex flex-col">
              <span className="text-base font-strong">@debater-a (you)</span>
              <span className="text-sm text-ink-muted">Aff</span>
            </span>
            <Badge tone="live">Speaking</Badge>
          </li>
          <li className="flex items-center justify-between rounded-lg bg-surface p-4 shadow-1">
            <span className="flex flex-col">
              <span className="text-base font-strong">@debater-b</span>
              <span className="text-sm text-ink-muted">Neg</span>
            </span>
            <Badge tone="neutral">Listening</Badge>
          </li>
        </ul>
        <p className="text-xs text-ink-faint">
          Room stage shown for context, with sample values. The room itself is
          built with the rooms. The judge is assigned by the system.
        </p>
      </div>
      {query.open ? <div aria-hidden="true" className={scrimClass} /> : null}
      <RoomPanel view={view} loadedAt={loadedAt} />
      {query.open ? null : (
        <section
          aria-label="Your prep"
          className="sticky bottom-0 hidden items-center gap-3 border-t border-border-strong bg-surface-raised px-4 py-3 shadow-3 max-compact:flex"
        >
          <PrepIcon name="book" size={18} className="text-accent" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-display text-md leading-tight font-bold">
              Your prep
            </span>
            <span className="text-sm text-ink-muted">{view.summary}</span>
          </span>
          <Badge tone="accent">Only you</Badge>
          <Link
            href={view.openHref}
            className={`${buttonClass('secondary')} no-underline hover:no-underline`}
          >
            Open
          </Link>
        </section>
      )}
    </div>
  );
}
