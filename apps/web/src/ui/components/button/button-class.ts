/**
 * What a button is, which decides the part of its look the Button owns.
 *
 * - `primary`, `secondary`, `ghost`, `on-media`: a standard action, whole
 *   look owned (shape, size, type, tone).
 * - `compact`: an action in a dense bar or panel (the Room, the round, the
 *   files): centred content, small type, disabled cursor. Its height,
 *   padding, radius and tone are the bar's.
 * - `icon`: a control shown as an icon (close, new, send, a toolbar tool):
 *   centred content and the disabled cursor. Its square size and tone are
 *   the toolbar's.
 * - `row`: a full row in a list, tree or menu: content laid out from the
 *   start, left-aligned text. Its height, padding and hover are the list's.
 * - `chip`: a bordered toggle whose pressed state is its accent border.
 * - `pill`: a rounded, bordered tag or quick action.
 * - `tab`: one of a strip of tabs or segments.
 * - `text`: an inline action that reads as strong text.
 * - `quiet`: a small muted text action under content (load more, dismiss).
 * - `touch`: onboarding's round, finger-sized action (links use it too).
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'on-media'
  | 'compact'
  | 'icon'
  | 'row'
  | 'chip'
  | 'pill'
  | 'tab'
  | 'text'
  | 'quiet'
  | 'touch';

// Variants never override the base: each owns its padding, so no two classes
// on one element ever set the same property. A site adds only what the
// variant leaves to it, never a property the variant sets.
const action =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm border text-base leading-tight font-strong transition-colors duration-120 ease-standard disabled:cursor-not-allowed disabled:opacity-60';

// A const, not a literal under `icon:`, which reads as an icon name to the icon check.
const iconControl =
  'flex cursor-pointer items-center justify-center disabled:cursor-not-allowed';

const variants: Readonly<Record<ButtonVariant, string>> = {
  primary: `${action} border-transparent bg-accent px-5 py-3 text-accent-ink hover:bg-accent-strong`,
  secondary: `${action} border-border-strong bg-transparent px-5 py-3 text-ink hover:border-ink-muted hover:text-ink`,
  ghost: `${action} border-transparent bg-transparent px-3 py-2 text-ink-muted hover:text-ink`,
  // Secondary action over a photograph: an opaque raised surface, so its ink
  // label reads in both schemes instead of the transparent outline's.
  'on-media': `${action} border-transparent bg-surface-raised px-5 py-3 text-ink hover:bg-surface-sunken`,
  compact:
    'inline-flex cursor-pointer items-center justify-center text-sm disabled:cursor-not-allowed',
  icon: iconControl,
  row: 'flex cursor-pointer items-center text-left disabled:cursor-default',
  chip: 'cursor-pointer border aria-pressed:border-accent disabled:cursor-not-allowed',
  pill: 'cursor-pointer rounded-round border disabled:cursor-not-allowed',
  tab: 'cursor-pointer items-center',
  text: 'cursor-pointer font-strong disabled:cursor-not-allowed',
  quiet:
    'min-h-nav-target cursor-pointer text-sm font-semibold text-ink-muted hover:text-ink',
  touch:
    'inline-flex min-h-onboarding-touch cursor-pointer items-center justify-center rounded-round px-6 text-md font-strong no-underline hover:no-underline',
};

/**
 * A standard action's compact size, for dense lists: `row` for row actions,
 * list expanders and header actions, `back` for back links. It swaps the
 * action's padding and type size, so each property keeps one value.
 */
export type ButtonSize = 'row' | 'back';

const sizes: Readonly<Record<ButtonSize, string>> = {
  row: 'min-h-12 px-3 text-base',
  back: 'min-h-10 px-3 text-sm',
};

/** Classes for a button of the given variant, at its compact size when given one. */
export const buttonClass = (
  variant: ButtonVariant,
  size?: ButtonSize,
): string =>
  size === undefined
    ? variants[variant]
    : variants[variant]
        .replace('px-5 py-3', sizes[size])
        .replace(' text-base ', ' ');
