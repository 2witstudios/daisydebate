import { WalkLink as Link } from '../walk/walk-link';
import type { TournamentsIndex } from '../../../features/tab/tournaments-index';
import { cn } from '../../cn';
import { TabLinks } from '../../components/tab-links/tab-links';
import {
  ActionButton,
  compactButtonClass,
} from '../action-control/action-control';
import { ListCard } from '../list-card/list-card';
import { IndexCalendarView } from './index-calendar';
import { IndexFilters } from './index-filters';
import {
  CountedHeading,
  Paging,
  PhoneGroups,
  PhoneRow,
  WideGroups,
} from './index-parts';

/** List or Calendar: two links, the current one filled. */
function ViewSwitch({ index }: { readonly index: TournamentsIndex }) {
  const views = [
    ['list', 'List', index.views.list],
    ['calendar', 'Calendar', index.views.calendar],
  ] as const;
  return (
    <nav
      aria-label="View"
      className="flex gap-1 rounded-md border border-border p-1"
    >
      {views.map(([id, label, href]) => (
        <Link
          key={id}
          href={href}
          aria-current={index.state.view === id ? 'page' : undefined}
          className={cn(
            compactButtonClass(
              index.state.view === id ? 'primary' : 'ghost',
              'row',
            ),
            'no-underline hover:no-underline',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The tournaments index: the viewer's own pinned at the top, then every
 * tournament the search and filters find, by tab in pages (by day on the
 * phone, by week on the desktop), or by day on a month's calendar.
 */
export function TournamentsDirectory({
  index,
}: {
  readonly index: TournamentsIndex;
}) {
  const { list, calendar } = index;
  return (
    <div className="mx-auto flex w-full max-w-host-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          Tournaments
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <ViewSwitch index={index} />
          {index.host === null ? null : (
            <ActionButton
              action={index.host}
              variant="secondary"
              size="small"
            />
          )}
        </div>
      </header>
      {list === null || index.yours.length === 0 ? null : (
        <ListCard label="You're in">
          <CountedHeading heading="You're in" count={index.yours.length} />
          <ul>
            {index.yours.map((row) => (
              <PhoneRow key={row.name} row={row} />
            ))}
          </ul>
        </ListCard>
      )}
      {list === null ? null : (
        <TabLinks
          label="Tournaments by when"
          className="border-b border-border"
          tabs={index.tabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            href: tab.href,
            selected: tab.selected,
            ...(tab.count === null ? {} : { count: tab.count }),
          }))}
        />
      )}
      <IndexFilters index={index} />
      {list === null ? null : (
        <>
          <p className="-mb-3 text-right text-sm text-ink-muted max-compact:hidden">
            {list.summary}
          </p>
          {list.days.length === 0 ? (
            <p className="text-ink-muted">
              No tournaments match. Try fewer filters.
            </p>
          ) : (
            <ListCard label="Tournaments">
              <div className="compact:hidden">
                <PhoneGroups groups={list.days} />
              </div>
              <div className="max-compact:hidden">
                <WideGroups groups={list.weeks} />
              </div>
              <Paging paging={list.paging} />
            </ListCard>
          )}
        </>
      )}
      {calendar === null ? null : <IndexCalendarView calendar={calendar} />}
    </div>
  );
}
