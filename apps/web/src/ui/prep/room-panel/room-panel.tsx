import Link from 'next/link';
import type { RoomPanelView } from '../../../features/prep/room-panel';
import { roomPanelHref } from '../../../features/prep/room-panel-query';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { controlClass } from '../form-controls/form-class';
import { PrepIcon } from '../prep-icon/prep-icon';
import { StateAlert } from '../state-alert/state-alert';
import { PanelOffline } from './panel-offline';
import { PinnedBody, SearchBox, SearchResults } from './panel-pinned';
import { roomPanelClass } from './room-panel-class';

const link = 'no-underline hover:no-underline';

export type RoomPanelProps = {
  readonly view: RoomPanelView;
  /** "12:04": when the page loaded, for the offline banner. */
  readonly loadedAt: string;
};

/**
 * Your prep, beside a live room. Read only, and rendered for the seat's owner
 * alone: no other seat, the judge or a spectator is sent anything from it.
 */
export function RoomPanel({ view, loadedAt }: RoomPanelProps) {
  const { query, body } = view;
  return (
    <aside
      aria-label="Your prep"
      className={roomPanelClass({ open: query.open, hidden: query.hidden })}
    >
      <header className="flex items-center gap-3">
        <span className="inline-flex size-avatar-md items-center justify-center rounded-md bg-accent-soft text-accent">
          <Icon name="book" size={18} />
        </span>
        <h2 className="flex-1 font-display text-lg leading-tight font-bold">
          Your prep
        </h2>
        <Badge tone="accent">Only you</Badge>
        <Link
          href={query.open ? view.closeHref : view.hideHref}
          aria-label="Hide panel"
          className="inline-flex size-12 items-center justify-center text-ink-muted"
        >
          <PrepIcon name="x" size={18} />
        </Link>
      </header>
      <PanelOffline
        since={loadedAt}
        retry={
          <Link
            href={roomPanelHref(query)}
            className={`${buttonClass('secondary')} ${link}`}
          >
            <PrepIcon name="refresh" size={18} />
            Try again
          </Link>
        }
      />
      {body.kind === 'choose' ? (
        <form
          action="/prep/in-debate"
          method="get"
          className="flex flex-col gap-3"
        >
          <h3 className="text-base font-bold">No case attached</h3>
          <label className="flex flex-col gap-1 text-xs font-strong text-ink-muted">
            Bring a case
            <select
              name="pin"
              defaultValue={body.options[0]?.value}
              className={controlClass}
            >
              {body.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="none">No case, search only</option>
            </select>
          </label>
          {query.open ? <input type="hidden" name="open" value="1" /> : null}
          <button type="submit" className={buttonClass('primary')}>
            Bring to this debate
          </button>
          <Link
            href={roomPanelHref({ pin: 'none', open: query.open })}
            className="self-start text-sm font-strong"
          >
            Continue without prep
          </Link>
        </form>
      ) : null}
      {body.kind === 'search-only' ? (
        <div className="flex flex-col gap-3">
          <SearchBox q={body.search.q} query={query} />
          <SearchResults search={body.search} query={query} pin="none" />
          <Link
            href={roomPanelHref({ open: query.open })}
            className="self-start text-sm font-strong"
          >
            Bring a case
          </Link>
        </div>
      ) : null}
      {body.kind === 'pinned' ? (
        <>
          <div className="flex min-h-12 items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-base font-strong">{body.caseTitle}</span>
              <span className="text-xs text-ink-muted">{`v${body.version} · pinned for this debate`}</span>
            </span>
            <Link href={body.changeHref} className="text-sm font-strong">
              Change
            </Link>
          </div>
          {body.notice === null ? null : <StateAlert notice={body.notice} />}
          <PinnedBody pinned={body} query={query} />
        </>
      ) : null}
      <footer className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-xs text-ink-muted">
        <Link
          href="/prep"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-strong"
        >
          Open Prep in a new tab
          <PrepIcon name="external" size={14} />
        </Link>
      </footer>
    </aside>
  );
}
