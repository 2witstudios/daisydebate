/**
 * A popover's visibility belongs to its open state, so the popover primitive
 * owns `display` (ADR 0153). Closed, it is hidden; open, it lays out as the
 * caller's `layout` asks. A caller's classes style the surface and may not
 * set display or flex direction: one bare `flex` once laid every closed seat
 * menu out on the Room page (SEAT-14a), because an author class beats the
 * browser's closed-popover rule.
 */

export type PopoverLayout = 'stack' | 'row';

/** Display utilities, by Tailwind name. Only the primitive writes these. */
const displayUtilities = [
  'block',
  'inline-block',
  'inline',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'contents',
  'flow-root',
  'list-item',
  'hidden',
  'table',
  'inline-table',
  'table-caption',
  'table-cell',
  'table-column',
  'table-column-group',
  'table-footer-group',
  'table-header-group',
  'table-row-group',
  'table-row',
] as const;

/** Flex direction follows `layout`, so the caller does not write it either. */
const directionUtilities = [
  'flex-col',
  'flex-col-reverse',
  'flex-row',
  'flex-row-reverse',
] as const;

export const primitiveOwnedUtilities: readonly string[] = [
  ...displayUtilities,
  ...directionUtilities,
];

type OwnedUtility =
  (typeof displayUtilities)[number] | (typeof directionUtilities)[number];

/** A utility without its variants (`md:`, `open:`) or important mark. */
const bare = (word: string): string =>
  (word.split(':').at(-1) ?? '').replace(/^!|!$/g, '');

/** The words in `className` that only the primitive may write. */
export const ownedUtilitiesIn = (className: string): readonly string[] =>
  className
    .split(/\s+/)
    .filter((word) => primitiveOwnedUtilities.includes(bare(word)));

type Words<S extends string> = S extends `${infer Head} ${infer Rest}`
  ? Head | Words<Rest>
  : S;
type Bare<W extends string> = W extends `${string}:${infer U}`
  ? Bare<U>
  : W extends `!${infer U}` | `${infer U}!`
    ? U
    : W;

/**
 * A literal className compiles only when it sets no display or direction;
 * a computed string is left to the runtime guard and the styling check.
 */
export type PopoverClassName<S extends string> = string extends S
  ? S
  : [Extract<Bare<Words<S>>, OwnedUtility>] extends [never]
    ? S
    : never;

const layoutClasses: Readonly<Record<PopoverLayout, string>> = {
  stack: 'not-open:hidden open:flex open:flex-col',
  row: 'not-open:hidden open:flex open:flex-row',
};

/**
 * The classes a popover renders with: hidden while closed, the requested
 * layout while open, then the caller's surface classes. A caller class that
 * sets display or direction is a programming error and throws.
 */
export const popoverClasses = ({
  layout = 'stack',
  className = '',
}: {
  readonly layout?: PopoverLayout | undefined;
  readonly className?: string | undefined;
}): string => {
  const owned = ownedUtilitiesIn(className);
  if (owned.length > 0)
    throw new Error(
      `A popover owns its display and direction; pass layout instead of: ${owned.join(' ')}`,
    );
  return [layoutClasses[layout], className.trim()].filter(Boolean).join(' ');
};
