import Link from 'next/link';
import type { ReactNode } from 'react';
import { tabRoutes } from '../../../features/tab/routes';
import type {
  IndexOption,
  TournamentsIndex,
} from '../../../features/tab/tournaments-index';
import { cn } from '../../cn';
import { buttonClass } from '../../components/button/button-class';
import { AutoSubmitForm } from '../../components/filter-bar/auto-submit-form';
import { summaryClass } from '../../components/filter-bar/filter-bar-class';
import {
  controlClass,
  FiltersLabel,
  SearchField,
} from '../../components/filter-form/filter-form';
import { Icon } from '../../components/icon/icon';
import { compactButtonClass } from '../action-control/action-control';

/**
 * A filter's label shows over it in the phone's sheet; on the desktop the
 * controls sit in a row and the label is for assistive technology only.
 */
function Field({
  label,
  className,
  children,
}: {
  readonly label: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex min-w-0 flex-col gap-1 max-compact:basis-full',
        className,
      )}
    >
      <span className="text-sm font-strong compact:sr-only">{label}</span>
      {children}
    </label>
  );
}

function Select({
  name,
  value,
  options,
}: {
  readonly name: string;
  readonly value: string | null;
  readonly options: readonly IndexOption[];
}) {
  return (
    <select name={name} defaultValue={value ?? ''} className={controlClass}>
      {options.map(([option, label]) => (
        <option key={option} value={option}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** The sheet's lower edge on the phone, the row's end on the desktop. */
const sheetClass =
  'details-content:contents max-compact:details-content:order-last max-compact:details-content:flex max-compact:details-content:basis-full max-compact:details-content:flex-col max-compact:details-content:gap-4 max-compact:details-content:rounded-lg max-compact:open:details-content:border max-compact:open:details-content:border-border max-compact:open:details-content:bg-surface-raised max-compact:open:details-content:p-4';

/**
 * Search and every filter as one GET form, so the index filters on the
 * server with no script; the address keeps the view, tab and calendar day.
 * On the phone the filters sit in a sheet behind "Filters N"; on the desktop
 * they are a row of selects.
 */
export function IndexFilters({ index }: { readonly index: TournamentsIndex }) {
  const { state, options } = index;
  const keep: [string, string | null][] = [
    ['view', state.view === 'calendar' ? 'calendar' : null],
    [
      'tab',
      state.view === 'list' && state.tab !== 'upcoming' ? state.tab : null,
    ],
    ['month', state.view === 'calendar' ? state.month : null],
    ['day', state.view === 'calendar' ? state.day : null],
  ];
  return (
    <div className="flex flex-col gap-3">
      <AutoSubmitForm
        action={tabRoutes.tournaments}
        role="search"
        aria-label="Filter tournaments"
        className="flex flex-wrap items-end gap-3"
      >
        {keep.map(([name, value]) =>
          value === null ? null : (
            <input key={name} type="hidden" name={name} value={value} />
          ),
        )}
        <SearchField
          defaultValue={state.q}
          maxLength={100}
          placeholder="Tournament, league or school"
          label="Search tournaments"
        />
        <details className={cn('contents', sheetClass)}>
          <summary className={summaryClass}>
            <FiltersLabel active={index.active} />
          </summary>
          <div className="flex items-center justify-between gap-3 compact:hidden">
            <h2 className="text-xl font-bold">Filters</h2>
            {index.clear === null ? null : (
              <Link
                href={index.clear}
                className={cn(
                  compactButtonClass('secondary', 'row'),
                  'no-underline hover:no-underline',
                )}
              >
                Clear all
              </Link>
            )}
          </div>
          <Field label="Format or event">
            <Select
              name="format"
              value={state.format}
              options={options.formats}
            />
          </Field>
          <Field label="League">
            <Select
              name="league"
              value={state.league}
              options={options.leagues}
            />
          </Field>
          <Field label="Division">
            <Select
              name="division"
              value={state.division}
              options={options.divisions}
            />
          </Field>
          <Field label="Online or in person">
            <Select name="mode" value={state.mode} options={options.modes} />
          </Field>
          <Field
            label={
              <>
                Near me{' '}
                <span className="font-book text-ink-muted">
                  · in person only
                </span>
              </>
            }
          >
            <Select name="near" value={state.near} options={options.near} />
          </Field>
          <Field label="From" className="max-compact:basis-full">
            <input
              type="date"
              name="from"
              defaultValue={state.from ?? ''}
              className={controlClass}
            />
          </Field>
          <Field label="To" className="max-compact:basis-full">
            <input
              type="date"
              name="to"
              defaultValue={state.to ?? ''}
              className={controlClass}
            />
          </Field>
          <label className="flex min-h-10 items-center gap-2 max-compact:basis-full max-compact:justify-between">
            <span className="flex flex-col">
              <span className="font-strong">Entry open</span>
              <span className="text-sm text-ink-muted compact:hidden">
                Hide ones you can no longer enter
              </span>
            </span>
            <input
              type="checkbox"
              name="open"
              value="1"
              defaultChecked={state.open}
              className="size-5 accent-accent max-compact:order-last"
            />
          </label>
          <button
            type="submit"
            className={cn(buttonClass('primary'), 'basis-full compact:hidden')}
          >
            {`Show ${index.found} tournament${index.found === 1 ? '' : 's'}`}
          </button>
          <button
            type="submit"
            className={cn(
              compactButtonClass('secondary', 'row'),
              'max-compact:hidden',
            )}
          >
            Apply
          </button>
        </details>
      </AutoSubmitForm>
      {index.chips.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label="Filters set" className="flex flex-wrap gap-2">
            {index.chips.map((chip) => (
              <li key={chip.label}>
                <Link
                  href={chip.remove}
                  aria-label={`${chip.label}: remove`}
                  className="flex min-h-10 items-center gap-2 rounded-round border border-border-strong bg-accent-soft px-3 font-strong text-ink no-underline hover:no-underline"
                >
                  {chip.label}
                  <Icon name="close" size={14} />
                </Link>
              </li>
            ))}
          </ul>
          {index.clear === null ? null : (
            <Link
              href={index.clear}
              className={cn(
                compactButtonClass('secondary', 'row'),
                'ml-auto no-underline hover:no-underline',
              )}
            >
              Clear
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
