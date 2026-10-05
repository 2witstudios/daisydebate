import Link from 'next/link';
import type { HitKind, SearchGroup } from '../../../features/search/search';
import { Badge } from '../../components/badge/badge';
import { PageHeader } from '../../components/page-header/page-header';
import { Panel } from '../../components/panel/panel';
import { ReadingPage } from '../../components/reading-page/reading-page';

const groupTitle: Readonly<Record<HitKind, string>> = {
  person: 'People',
  debate: 'Debates',
  tournament: 'Tournaments',
  room: 'Rooms',
};

type SearchPageProps = {
  readonly query: string;
  readonly groups: readonly SearchGroup[];
  readonly total: number;
};

function Summary({ query, total }: Pick<SearchPageProps, 'query' | 'total'>) {
  if (query === '') return '';
  if (total === 0) return `Nothing matches “${query}”`;
  return `${total} ${total === 1 ? 'result' : 'results'} for “${query}”.`;
}

/** Search across people, debates, tournaments and rooms. A plain GET form. */
export function SearchPage({ query, groups, total }: SearchPageProps) {
  return (
    <ReadingPage>
      <PageHeader
        title="Search"
        lede={<Summary query={query} total={total} />}
      />
      <form
        role="search"
        action="/search"
        method="get"
        className="flex items-center gap-3"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-bold text-ink">
          Search Daisy Debate
          <input
            type="search"
            name="q"
            defaultValue={query}
            className="rounded-sm border border-border bg-surface-sunken px-4 py-2 text-base text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink"
        >
          Search
        </button>
      </form>
      {groups.map((group) => (
        <Panel key={group.kind} title={groupTitle[group.kind]}>
          <ul className="flex flex-col gap-3">
            {group.items.map((item) => (
              <li
                key={item.href}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <Link href={item.href} className="text-base font-bold">
                  {item.label}
                </Link>
                <Badge>{item.detail}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </ReadingPage>
  );
}
