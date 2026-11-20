import { WalkLink as Link } from '../walk/walk-link';
import type { PageFilter, StatusChoice } from '../../../features/tab/at-scale';
import { cn } from '../../cn';
import { SearchField } from '../../components/filter-form/filter-form';
import { SearchForm } from '../../components/search-form/search-form';

/** A status choice drawn as one segment of the filter: the chosen one is filled. */
export const segmentClass = (selected: boolean): string =>
  cn(
    'inline-flex min-h-10 items-center gap-2 rounded-sm px-3 text-sm whitespace-nowrap no-underline hover:no-underline',
    selected
      ? 'bg-surface-sunken font-strong text-ink'
      : 'text-ink-muted hover:text-ink',
  );

/** The page's own params (a draw's `?fixture=`), which a search keeps. */
const ownParams = (path: string): readonly (readonly [string, string])[] =>
  [...new URLSearchParams(path.split('?')[1] ?? '')].filter(
    ([key]) => key !== 'q' && key !== 'status' && key !== 'open',
  );

/**
 * Search and a status filter within one page ("Find a room, entry or judge"
 * beside All 120, Waiting 2, Live 54 …). It is a GET form and links, so it
 * works before hydration and the page reads the same data: the page parses
 * its URL with `pageFilterOf` and filters the rows it already read with
 * `filterRows`; `statusChoices` gives the choices.
 */
export function InPageSearch<Status extends string>({
  path,
  filter,
  placeholder,
  label,
  statusLabel,
  choices,
}: {
  /** The page's address, with any params of its own. */
  readonly path: string;
  readonly filter: PageFilter<Status>;
  readonly placeholder: string;
  /** The search box's accessible name, such as "Find a room, entry or judge". */
  readonly label: string;
  /** The status filter's name, such as "Rooms by status". */
  readonly statusLabel: string;
  readonly choices: readonly StatusChoice[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <SearchForm
        action={path.split('?')[0] ?? path}
        role="search"
        className="flex min-w-0 grow basis-1/2"
      >
        {ownParams(path).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        {filter.status === 'all' ? null : (
          <input type="hidden" name="status" value={filter.status} />
        )}
        <SearchField
          defaultValue={filter.query}
          maxLength={80}
          placeholder={placeholder}
          label={label}
        />
        <button type="submit" className="sr-only">
          Search
        </button>
      </SearchForm>
      {choices.length === 0 ? null : (
        <nav aria-label={statusLabel}>
          <ul className="flex flex-wrap gap-1 rounded-md border border-border bg-surface-raised p-1">
            {choices.map((choice) => (
              <li key={choice.id}>
                <Link
                  href={choice.href}
                  aria-current={choice.selected ? 'true' : undefined}
                  className={segmentClass(choice.selected)}
                >
                  {choice.label}
                  <span className="font-book text-ink-faint">
                    {choice.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
