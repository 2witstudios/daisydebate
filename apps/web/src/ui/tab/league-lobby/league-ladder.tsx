import type { LadderRow, LeaguePanel } from '../../../features/tab/league';
import { cn } from '../../cn';
import { AutoSubmitForm } from '../../components/filter-bar/auto-submit-form';
import {
  FilterSelect,
  SearchField,
} from '../../components/filter-form/filter-form';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { ListCard } from '../list-card/list-card';

type Ladder = Extract<LeaguePanel, { kind: 'ladder' }>;

/** A rating's last change, signed: `+12`, `−4`, `0`. */
export const changeLabel = (change: number): string =>
  change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '0';

function Row({ row }: { readonly row: LadderRow }) {
  return (
    <li
      aria-current={row.you ? 'true' : undefined}
      className={cn(
        'flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0',
        row.you && 'bg-hue-teal-soft',
      )}
    >
      <span className="w-6 text-ink-muted tabular-nums">{row.place}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <ActionLink action={row.profile} className="self-start" />
        <span className="text-sm text-ink-muted">
          {row.school} · {row.record}
        </span>
      </span>
      <span className="font-strong tabular-nums">{row.rating}</span>
      <span className="w-8 text-right text-sm text-ink-muted tabular-nums">
        {changeLabel(row.change)}
      </span>
    </li>
  );
}

/**
 * A league's own ladder. Scope and search ride in the address as one GET
 * form, as on Daisy's ladder, so it filters with no script.
 */
export function LeagueLadder({ ladder }: { readonly ladder: Ladder }) {
  return (
    <>
      <section aria-label="Ladder" className="flex flex-col gap-3">
        <AutoSubmitForm
          action={ladder.address}
          role="search"
          aria-label="Filter the ladder"
          className="flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="tab" value="ladder" />
          <FilterSelect
            name="scope"
            label="Scope"
            value={ladder.scope}
            options={[
              ['top', 'Top of the ladder'],
              ['around', 'Around me'],
            ]}
          />
          <SearchField
            defaultValue={ladder.search}
            maxLength={40}
            placeholder="Search"
            label="Search for a debater"
          />
        </AutoSubmitForm>
        <ListCard>
          <ol>
            {ladder.rows.map((row) => (
              <Row key={row.place} row={row} />
            ))}
          </ol>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-sm text-ink-muted">{ladder.count}</span>
            {ladder.next === null ? null : (
              <ActionButton action={ladder.next} />
            )}
          </div>
        </ListCard>
      </section>
      <p className="text-sm text-ink-muted">
        {ladder.note} <ActionLink action={ladder.rules} />
      </p>
    </>
  );
}
