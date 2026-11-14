import type { TournamentGroup } from '../../../features/tab/tournament';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/** Tournaments in headed groups, each with its one way in. */
export function TournamentGroups({
  label,
  groups,
}: {
  readonly label: string;
  readonly groups: readonly TournamentGroup[];
}) {
  return (
    <ListCard label={label}>
      {groups.map((group) => (
        <section
          key={group.heading}
          className="border-b border-border last:border-b-0"
        >
          <ListHeading>{group.heading}</ListHeading>
          <ul>
            {group.rows.map((row) => (
              <ListRow
                key={row.name}
                title={row.name}
                detail={row.detail}
                trailing={<ActionButton action={row.action} about={row.name} />}
              />
            ))}
            {group.more === null ? null : (
              <li className="px-4 py-3">
                <ActionLink action={group.more} />
              </li>
            )}
          </ul>
        </section>
      ))}
    </ListCard>
  );
}
