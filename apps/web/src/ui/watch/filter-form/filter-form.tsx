import Link from 'next/link';
import type { ReactNode } from 'react';
import { MAX_SEARCH_LENGTH } from '../../../features/watch/live-query';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import { controlClass } from '../../lobby/filter-bar/filter-bar-class';
import { ModeToggle } from '../../lobby/mode-toggle/mode-toggle';

export type FilterFormProps = {
  readonly action: string;
  readonly label: string;
  readonly search: {
    readonly value: string;
    readonly label: string;
    readonly placeholder: string;
  };
  readonly mode: 'any' | 'ranked' | 'casual';
  readonly sort: {
    readonly value: string;
    readonly label: string;
    readonly options: readonly (readonly [string, string])[];
  };
  /** Extra controls before the mode toggle, such as the archive's scope. */
  readonly leading?: ReactNode;
  /** Where Clear goes; null when no filter is set. */
  readonly clearHref: string | null;
};

/**
 * The hub's filters as one GET form: search, mode, sort and Apply. The URL
 * carries the state, so it works with no script; selects and radios also
 * apply at once when hydrated.
 */
export function FilterForm({
  action,
  label,
  search,
  mode,
  sort,
  leading,
  clearHref,
}: FilterFormProps) {
  return (
    <AutoSubmitForm
      action={action}
      role="search"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-3 gap-y-3"
    >
      <label
        className={cn(
          controlClass,
          'flex grow basis-1/4 items-center gap-2 text-ink-muted',
        )}
      >
        <Icon name="search" size={16} />
        <input
          type="search"
          name="q"
          defaultValue={search.value}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder={search.placeholder}
          aria-label={search.label}
          className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
        />
      </label>
      {leading}
      <ModeToggle value={mode} />
      <select
        name="sort"
        aria-label={sort.label}
        defaultValue={sort.value}
        className={controlClass}
      >
        {sort.options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      <button type="submit" className={buttonClass('secondary')}>
        Apply
      </button>
      {clearHref === null ? null : (
        <Link
          href={clearHref}
          className="flex min-h-10 items-center px-1 text-base font-strong"
        >
          Clear
        </Link>
      )}
    </AutoSubmitForm>
  );
}
