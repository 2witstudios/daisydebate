import type { LeaguePanel } from '../../../features/tab/league';
import { AutoSubmitForm } from '../../components/filter-bar/auto-submit-form';
import { FilterSelect } from '../../components/filter-form/filter-form';
import { ActionLink } from '../action-control/action-control';
import { ListCard, ListHeading } from '../list-card/list-card';
import { SeasonStandings } from '../season-standings/season-standings';

type Season = Extract<LeaguePanel, { kind: 'season' }>;

/** A league's season standings for one event, and how its points count. */
export function LeagueSeason({ season }: { readonly season: Season }) {
  return (
    <>
      <ListCard label="Season standings">
        <AutoSubmitForm
          action={season.address}
          aria-label="Choose an event"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"
        >
          <input type="hidden" name="tab" value="season" />
          <strong className="font-strong">{season.season}</strong>
          <FilterSelect
            name="event"
            label="Event"
            value={season.event}
            options={season.events.map(
              (event) => [event.slug, event.name] as const,
            )}
          />
        </AutoSubmitForm>
        <SeasonStandings rows={season.rows} />
        <p className="border-t border-border px-4 py-3">
          <ActionLink action={season.all} />
        </p>
      </ListCard>
      <ListCard>
        <ListHeading>How points count</ListHeading>
        <ul>
          {season.points.map((rule) => (
            <li
              key={rule.label}
              className="flex justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span>{rule.label}</span>
              <span className="text-ink-muted tabular-nums">
                {rule.points} points
              </span>
            </li>
          ))}
        </ul>
      </ListCard>
      <p className="text-sm text-ink-muted">
        {season.note} <ActionLink action={season.tournaments} />
      </p>
    </>
  );
}
