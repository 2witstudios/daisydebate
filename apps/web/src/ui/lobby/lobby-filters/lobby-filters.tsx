import {
  defaultLobbyFilters,
  isFiltered,
  lobbyHref,
  lobbyStatuses,
  type LobbyQuery,
  type LobbyStatus,
} from '../../../features/lobby/discovery-query';
import {
  ClearFilters,
  FilterFooter,
  FilterSelect,
  FiltersLabel,
  SearchField,
} from '../../components/filter-form/filter-form';
import { TabLinks } from '../../components/tab-links/tab-links';
import { AutoSubmitForm } from '../filter-bar/auto-submit-form';
import {
  dividerClass,
  filterBarClass,
  panelClass,
  summaryClass,
} from '../filter-bar/filter-bar-class';

const statusLabels: Readonly<Record<LobbyStatus, string>> = {
  all: 'All',
  open: 'Open',
  starting: 'Starting',
  live: 'Live',
};

const modeOptions = [
  ['any', 'Ranked or casual'],
  ['ranked', 'Ranked'],
  ['casual', 'Casual'],
] as const;

const lengthOptions = [
  ['any', 'Any length'],
  ['quick', 'Quick'],
  ['full', 'Full'],
] as const;

/** Search the protocol accepts; the field's maxlength matches it. */
const MAX_SEARCH_LENGTH = 100;

/**
 * Status tabs plus search, mode and length as one GET form: the URL carries
 * the state, so the Lobby filters on the server with no script. On the phone
 * mode and length sit in a panel behind "Filters".
 */
export function LobbyFilters({
  query,
  resultCount,
}: {
  readonly query: LobbyQuery;
  readonly resultCount: number;
}) {
  const { filters, list } = query;
  const active = [filters.mode, filters.length].filter(
    (value) => value !== 'any',
  ).length;
  return (
    <AutoSubmitForm
      action="/lobby"
      role="search"
      aria-label="Filter rooms"
      className={filterBarClass}
    >
      <input type="hidden" name="status" value={filters.status} />
      {list.pageSize === 20 ? null : (
        <input type="hidden" name="pageSize" value={list.pageSize} />
      )}
      <TabLinks
        label="Room status"
        className="order-1 min-w-0 flex-1 max-compact:basis-full"
        tabs={lobbyStatuses.map((status) => ({
          id: status,
          label: statusLabels[status],
          href: lobbyHref({ list, filters: { ...filters, status } }),
          selected: filters.status === status,
        }))}
      />
      <div className={dividerClass} aria-hidden="true" />
      <SearchField
        defaultValue={list.q}
        maxLength={MAX_SEARCH_LENGTH}
        placeholder="Room, topic or host"
        label="Search rooms"
      />
      <details className={`contents ${panelClass}`}>
        <summary className={summaryClass}>
          <FiltersLabel active={active} />
        </summary>
        <div className="contents max-compact:grid max-compact:grid-cols-2 max-compact:gap-3">
          <FilterSelect
            name="mode"
            label="Ranked or casual"
            value={filters.mode}
            options={modeOptions}
            className="order-5 max-compact:order-none"
          />
          <FilterSelect
            name="length"
            label="Length"
            value={filters.length}
            options={lengthOptions}
            className="order-6 max-compact:order-none"
          />
        </div>
        <ClearFilters
          href={
            isFiltered(filters) || list.q !== ''
              ? lobbyHref({
                  list: { ...list, q: '' },
                  filters: { ...defaultLobbyFilters, status: filters.status },
                })
              : null
          }
        />
      </details>
      <FilterFooter count={resultCount} noun="room" />
    </AutoSubmitForm>
  );
}
