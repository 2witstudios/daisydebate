import type { ReactNode } from 'react';
import {
  linkTo,
  unavailableAction,
  type TabAction,
} from '../../../features/tab/action';
import type { Collapsed } from '../../../features/tab/at-scale';
import { ActionButton } from '../action-control/action-control';
import { ListRow } from '../list-card/list-card';

/**
 * One row that stands for several: a merged "6 ballots are overdue" with
 * "Remind all 6", or a counted "31 more judging" with "Show all 34". Its
 * action is a button, never an underlined link. It is a list item, so it
 * sits in the `<ul>` of the rows it counts.
 */
export function CountedRow({
  title,
  detail,
  action,
  about,
}: {
  readonly title: string;
  readonly detail?: ReactNode;
  readonly action: TabAction;
  /** What the button acts on, where its label alone repeats down a page. */
  readonly about?: string;
}) {
  return (
    <ListRow
      title={title}
      detail={detail}
      trailing={
        <ActionButton action={action} size="small" about={about ?? title} />
      }
    />
  );
}

/** "31 more judging", "52 more schools". */
export const collapsedTitle = (rest: number, noun: string): string =>
  `${rest} more ${noun}`;

/**
 * The counted remainder of a collapsed group, or nothing when the group is
 * shown whole. `href` is the page with the group open (`showAllHref`); with
 * none the button answers as a sample action.
 */
export function CollapsedRow<Item>({
  group,
  noun,
  detail,
  href,
  label,
}: {
  readonly group: Collapsed<Item>;
  readonly noun: string;
  readonly detail?: ReactNode;
  readonly href: string | null;
  /** The button's label where "Show all N" does not read right, such as "Show 7". */
  readonly label?: string;
}) {
  if (group.rest === 0) return null;
  const text = label ?? `Show all ${group.total}`;
  return (
    <CountedRow
      title={collapsedTitle(group.rest, noun)}
      detail={detail}
      action={href === null ? unavailableAction(text) : linkTo(text, href)}
      about={noun}
    />
  );
}
