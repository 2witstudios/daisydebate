import { roomListDefaultPageSize, type RoomListQuery } from '@daisy/protocol';
import {
  divisionAudiences,
  divisionLabels,
} from '../../../features/ratings/ladder-labels';
import {
  filterCount,
  isFiltered,
  lobbyDivisionChoices,
  lobbyHref,
  lobbyModeChoices,
  lobbySortChoices,
  lobbyStatusChoices,
  type LobbyDivision,
  type LobbyMode,
  type LobbySort,
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
import { AutoSubmitForm } from '../../components/filter-bar/auto-submit-form';
import {
  dividerClass,
  filterBarClass,
  panelClass,
  summaryClass,
} from '../../components/filter-bar/filter-bar-class';

const statusLabels: Readonly<Record<LobbyStatus, string>> = {
  all: 'All',
  open: 'Open',
  starting: 'Starting',
  live: 'Live',
};

const modeLabels: Readonly<Record<LobbyMode, string>> = {
  any: 'Ranked or casual',
  ranked: 'Ranked',
  casual: 'Casual',
};

const modeOptions = lobbyModeChoices.map(
  (mode) => [mode, modeLabels[mode]] as const,
);

/** Who debates on each division, as the filter names it (ADR 0147). */
const divisionChoiceLabels: Readonly<Record<LobbyDivision, string>> = {
  any: 'Any division',
  youth: `${divisionLabels.youth} (${divisionAudiences.youth.toLowerCase()})`,
  open: `${divisionLabels.open} (${divisionAudiences.open})`,
};

const divisionOptions = lobbyDivisionChoices.map(
  (division) => [division, divisionChoiceLabels[division]] as const,
);

const sortLabels: Readonly<Record<LobbySort, string>> = {
  newest: 'Newest',
  'longest-waiting': 'Longest waiting',
};

const sortOptions = lobbySortChoices.map(
  (sort) => [sort, sortLabels[sort]] as const,
);

/** Search the protocol accepts; the field's maxlength matches it. */
const MAX_SEARCH_LENGTH = 100;

/**
 * Status tabs plus search, division, mode and sort as one GET form: the URL carries
 * the state, so the Lobby filters and sorts on the server with no script. On
 * the phone the division, mode and sort sit in a panel behind "Filters"; the sort is an
 * order, not a filter, so it never counts toward the Filters badge.
 */
export function LobbyFilters({
  query,
  resultCount,
}: {
  readonly query: RoomListQuery;
  readonly resultCount: number;
}) {
  const status: LobbyStatus = query.status ?? 'all';
  return (
    <AutoSubmitForm
      action="/lobby"
      role="search"
      aria-label="Filter rooms"
      className={filterBarClass}
    >
      {query.status ? (
        <input type="hidden" name="status" value={query.status} />
      ) : null}
      {query.pageSize === roomListDefaultPageSize ? null : (
        <input type="hidden" name="pageSize" value={query.pageSize} />
      )}
      <TabLinks
        label="Room status"
        className="order-1 min-w-0 flex-1 max-compact:basis-full"
        tabs={lobbyStatusChoices.map((choice) => ({
          id: choice,
          label: statusLabels[choice],
          href: lobbyHref({
            ...query,
            status: choice === 'all' ? undefined : choice,
          }),
          selected: status === choice,
        }))}
      />
      <div className={dividerClass} aria-hidden="true" />
      <SearchField
        defaultValue={query.q}
        maxLength={MAX_SEARCH_LENGTH}
        placeholder="Room, topic or host"
        label="Search rooms"
      />
      <details className={`contents ${panelClass}`}>
        <summary className={summaryClass}>
          <FiltersLabel active={filterCount(query)} />
        </summary>
        <FilterSelect
          name="division"
          label="Division"
          value={query.division ?? 'any'}
          options={divisionOptions}
          className="order-5 max-compact:order-none"
        />
        <FilterSelect
          name="mode"
          label="Ranked or casual"
          value={query.mode ?? 'any'}
          options={modeOptions}
          className="order-5 max-compact:order-none"
        />
        <FilterSelect
          name="sort"
          label="Sort rooms"
          value={query.sort ?? 'newest'}
          options={sortOptions}
          className="order-6 max-compact:order-none"
        />
        <ClearFilters
          href={
            isFiltered(query) || query.q !== ''
              ? lobbyHref({
                  q: '',
                  pageSize: query.pageSize,
                  status: query.status,
                  sort: query.sort,
                })
              : null
          }
        />
      </details>
      <FilterFooter count={resultCount} noun="room" />
    </AutoSubmitForm>
  );
}
