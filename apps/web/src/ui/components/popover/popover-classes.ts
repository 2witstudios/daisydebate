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

/** Splits a class word at its top-level colons: variants, then the utility. */
const variantsAndUtility = (word: string): readonly string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of word) {
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    if (char === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  return [...parts, current];
};

/** Variants that style a pseudo-element, not the popover's own box. */
const pseudoElements = [
  'backdrop',
  'before',
  'after',
  'placeholder',
  'file',
  'marker',
  'selection',
  'first-line',
  'first-letter',
  'details-content',
] as const;

/**
 * A variant that styles something other than the popover's box: a
 * pseudo-element (`backdrop:`, `before:`), `*:`, `**:`, or an arbitrary
 * variant with a combinator (`[&>li]:`, `[&_p]:`).
 */
const targetsOtherBox = (variant: string): boolean =>
  variant === '*' ||
  variant === '**' ||
  (pseudoElements as readonly string[]).includes(variant) ||
  (variant.startsWith('[&') && /[>_+~]/.test(variant));

/** An arbitrary property that sets display or direction, as `[display:flex]`. */
const ownedProperty = /^\[(?:display|flex-direction):/;

const ownsLayout = (word: string): boolean => {
  const parts = variantsAndUtility(word.replace(/^!|!$/g, ''));
  const utility = (parts.at(-1) ?? '').replace(/^!|!$/g, '');
  if (parts.slice(0, -1).some(targetsOtherBox)) return false;
  return (
    primitiveOwnedUtilities.includes(utility) || ownedProperty.test(utility)
  );
};

/** The words in `className` that only the primitive may write. */
export const ownedUtilitiesIn = (className: string): readonly string[] =>
  className.split(/\s+/).filter((word) => word !== '' && ownsLayout(word));

type Words<S extends string> =
  S extends `${infer Head}${' ' | '\n' | '\t'}${infer Rest}`
    ? Head | Words<Rest>
    : S;
type Unmarked<W extends string> = W extends `!${infer U}` | `${infer U}!`
  ? U
  : W;
type Bare<W extends string> = W extends `${string}:${infer U}`
  ? Bare<U>
  : Unmarked<W>;
/** Mirrors ownsLayout: other boxes pass, arbitrary display properties do not. */
type Owned<W extends string> = W extends
  | `*${string}`
  | `${string}${(typeof pseudoElements)[number]}:${string}`
  | `[&${string}${'>' | '_' | '+' | '~'}${string}]:${string}`
  ? never
  : W extends `${string}[${'display' | 'flex-direction'}:${string}`
    ? W
    : Bare<W> extends OwnedUtility
      ? W
      : never;

/**
 * A literal className compiles only when it sets no display or direction;
 * a computed string is left to the runtime guard and the styling check.
 */
export type PopoverClassName<S extends string> = string extends S
  ? S
  : [Owned<Words<S>>] extends [never]
    ? S
    : never;

const layoutClasses: Readonly<Record<PopoverLayout, string>> = {
  stack: 'not-open:hidden open:flex open:flex-col',
  row: 'not-open:hidden open:flex open:flex-row',
};

/**
 * The classes a popover renders with: hidden while closed, the requested
 * layout while open, then the caller's surface classes. A caller class that
 * sets display or direction is dropped, so a computed slip past the type
 * check and the styling check costs that class, never the route; `strict`
 * throws instead, for tests and checks (ADR 0153).
 */
export const popoverClasses = ({
  layout = 'stack',
  className = '',
  strict = false,
}: {
  readonly layout?: PopoverLayout | undefined;
  readonly className?: string | undefined;
  /** Throw on an owned class rather than drop it. */
  readonly strict?: boolean | undefined;
}): string => {
  const owned = ownedUtilitiesIn(className);
  if (owned.length > 0 && strict)
    throw new Error(
      `A popover owns its display and direction; pass layout instead of: ${owned.join(' ')}`,
    );
  const surface = className
    .split(/\s+/)
    .filter((word) => word !== '' && !owned.includes(word));
  return [layoutClasses[layout], ...surface].join(' ');
};
