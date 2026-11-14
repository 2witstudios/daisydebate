import type { TournamentPanel } from '../../../features/tab/tournament';
import { SearchableGroups } from '../searchable-groups/searchable-groups';

type Posting = Extract<TournamentPanel, { kind: 'posting' }>;

/** A member's school comes first; the public finds an entry by its school. */
export function SchoolPostings({ panel }: { readonly panel: Posting }) {
  const schools = [...new Set(panel.rows.flatMap((row) => row.schools))].sort(
    (a, b) => a.localeCompare(b),
  );
  const own = panel.school;
  const groups = [
    ...(own === null
      ? []
      : [
          {
            heading: `Your school · ${own}`,
            limit: 2,
            rows: panel.rows.filter((row) => row.schools.includes(own)),
          },
        ]),
    ...schools
      .filter((school) => school !== own)
      .map((school) => ({
        heading: school,
        limit: 0,
        rows: panel.rows.filter((row) => row.schools.includes(school)),
      })),
  ];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-strong">{panel.heading} · By school</h2>
      <SearchableGroups
        groupLimit={own === null ? 4 : 1}
        label="Find a name, school or room"
        groups={groups.map((group) => ({
          ...group,
          rows: group.rows.map((row) => ({ ...row, words: row.schools })),
        }))}
      />
    </section>
  );
}
