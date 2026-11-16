import { WalkLink as Link } from '../walk/walk-link';
import type {
  CalendarDay,
  IndexCalendar,
} from '../../../features/tab/tournaments-index';
import { cn } from '../../cn';
import { compactButtonClass } from '../action-control/action-control';
import { ListCard } from '../list-card/list-card';
import { CountedHeading, Paging, PhoneRow } from './index-parts';

const weekdays = [
  ['S', 'Sunday'],
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
] as const;

const tournamentsWord = (count: number) =>
  `${count} tournament${count === 1 ? '' : 's'}`;

/** A day's count under its number: a dot for one, the number for more. */
function DayMark({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return count === 1 ? (
    <span aria-hidden="true" className="size-2 rounded-round bg-current" />
  ) : (
    <span aria-hidden="true" className="text-xs tabular-nums">
      {count}
    </span>
  );
}

function Day({
  day,
  title,
}: {
  readonly day: CalendarDay;
  readonly title: string;
}) {
  const look = cn(
    'mx-auto flex size-12 flex-col items-center justify-center gap-1 rounded-md text-base no-underline hover:no-underline max-compact:size-12',
    day.selected
      ? 'text-accent-ink'
      : !day.inMonth || day.past
        ? 'text-ink-faint'
        : 'text-ink',
    day.count > 0 && 'font-strong',
    day.today && !day.selected && 'border border-ink',
    day.selected && 'bg-accent',
  );
  const label = `${day.number} ${title}, ${tournamentsWord(day.count)}`;
  const body = (
    <>
      <span className="tabular-nums">{day.number}</span>
      {day.inMonth ? <DayMark count={day.count} /> : null}
    </>
  );
  return (
    <td className="p-1 text-center">
      {day.href === null ? (
        <span
          className={look}
          aria-label={day.inMonth ? label : undefined}
          aria-current={day.selected ? 'date' : undefined}
        >
          {body}
        </span>
      ) : (
        <Link href={day.href} className={look} aria-label={label}>
          {body}
        </Link>
      )}
    </td>
  );
}

/** A month of days with how many tournaments start on each, then one day's. */
export function IndexCalendarView({
  calendar,
}: {
  readonly calendar: IndexCalendar;
}) {
  const month = calendar.title.split(' ')[0] ?? calendar.title;
  const step = compactButtonClass('secondary', 'row');
  return (
    <>
      <ListCard label="Calendar" className="p-3">
        <div className="flex items-center justify-between gap-3 pb-2">
          {calendar.previous === null ? (
            <span className="size-12" />
          ) : (
            <Link
              href={calendar.previous}
              className={cn(step, 'no-underline hover:no-underline')}
              aria-label="Previous month"
            >
              ‹
            </Link>
          )}
          <h2 className="text-lg font-strong">{calendar.title}</h2>
          {calendar.next === null ? (
            <span className="size-12" />
          ) : (
            <Link
              href={calendar.next}
              className={cn(step, 'no-underline hover:no-underline')}
              aria-label="Next month"
            >
              ›
            </Link>
          )}
        </div>
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">{`Tournaments in ${calendar.title}, by day`}</caption>
          <thead>
            <tr>
              {weekdays.map(([letter, name]) => (
                <th
                  key={name}
                  scope="col"
                  abbr={name}
                  className="pb-1 text-sm font-strong text-ink-muted"
                >
                  {letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calendar.weeks.map((week) => (
              <tr key={week[0]?.date}>
                {week.map((day) => (
                  <Day key={day.date} day={day} title={month} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {calendar.day === null ? null : (
        <ListCard label={calendar.day.heading}>
          <CountedHeading
            heading={calendar.day.heading}
            count={tournamentsWord(calendar.day.count)}
          />
          {calendar.day.count === 0 ? (
            <p className="px-4 py-3 text-ink-muted">
              No tournaments start this day.
            </p>
          ) : (
            <>
              <ul>
                {calendar.day.rows.map((row) => (
                  <PhoneRow key={row.name} row={row} />
                ))}
              </ul>
              <Paging paging={calendar.day.paging} />
            </>
          )}
        </ListCard>
      )}
    </>
  );
}
