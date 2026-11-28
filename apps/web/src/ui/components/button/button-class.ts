import { navFlyoutItemShape, navItemShape } from '../nav-item/nav-item-class';

/**
 * Every button look, owned here: a variant names what the control is and
 * carries its whole look (shape, type, ink, hover and pressed states), and
 * its sizes are data, one class list per size it comes in. A site adds only
 * layout (width, margins, order, alignment in its parent), never a property
 * its variant or size sets, so no two classes on one element set the same
 * property. Links drawn as buttons take the same classes (`buttonClass`).
 */

// The standard action's shape and type, without padding or size.
const action =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm border leading-tight font-strong transition-colors duration-120 ease-standard disabled:cursor-not-allowed disabled:opacity-60';

/** The sizes a standard action comes in. */
const actionSizes = {
  /** The page's own action. */
  regular: 'px-5 py-3 text-base',
  /** A small action beside content: a card's or a draft's. */
  small: 'px-3 py-2 text-sm',
  /** An action in a Room, round or files bar, one line high. */
  room: 'min-h-room-target px-4 text-sm whitespace-nowrap',
  /** A Room-bar action stretched to the phone bar's height. */
  bar: 'h-12 px-4 text-md whitespace-nowrap',
  /** A row action, list expander or header action in a dense list. */
  row: 'min-h-12 px-3 text-base',
  /** A back link. */
  back: 'min-h-10 px-3 text-sm',
  /** An action at the nav target's height (a card on the stage). */
  nav: 'min-h-nav-target px-4 text-base',
  /** The sign-in and onboarding forms' control height. */
  auth: 'h-auth-control px-5 text-base',
} as const;

// A const, not a literal under `icon:`, which reads as an icon name to the icon check.
const iconShape =
  'flex shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const iconSizes = {
  /** The composer's send: a 40px square. */
  regular: 'size-10',
  /** A toolbar, tree or tab-strip control. */
  dense: 'size-dense-target',
  /** A Room-bar control. */
  room: 'size-room-target',
  /** A rail or dialog control at the nav target. */
  nav: 'size-nav-target',
  /** A roster control. */
  roster: 'size-roster-control',
  /** A toast's dismiss. */
  toast: 'size-toast-target',
  /** The full height of a tab strip, a strip square wide. */
  strip: 'h-full w-tab-strip',
} as const;

const rowShape =
  'flex cursor-pointer items-center gap-2 rounded-sm text-left text-sm no-underline transition-colors hover:bg-surface-overlay hover:no-underline disabled:cursor-default disabled:text-ink-muted';
const rowSizes = {
  /** A menu or list row at the nav target. */
  regular: 'min-h-nav-target px-2',
  /** A file tree or file menu row. */
  dense: 'min-h-dense-target px-2',
  /** A Room sidebar row. */
  room: 'min-h-room-target px-2',
  /** A roster menu row. */
  roster: 'min-h-roster-control px-2',
  /** A switcher or timeline row with its own breathing room. */
  menu: 'px-3 py-2',
  /** A row flush with its column (a transcript line). */
  flush: 'py-2',
} as const;

const touchShape =
  'inline-flex min-h-onboarding-touch cursor-pointer items-center justify-center rounded-round px-6 text-md font-strong no-underline hover:no-underline disabled:cursor-wait disabled:opacity-60';

const looks = {
  // Standard actions.
  primary: {
    look: `${action} border-transparent bg-accent text-accent-ink hover:bg-accent-strong`,
    sizes: actionSizes,
  },
  secondary: {
    look: `${action} border-border-strong bg-transparent text-ink hover:border-ink-muted hover:text-ink`,
    sizes: actionSizes,
  },
  /** A point of information's move: offering one, or taking it (INTX-18). */
  point: {
    look: `${action} border-transparent bg-butter text-forest hover:bg-yolk`,
    sizes: actionSizes,
  },
  ghost: {
    look: `${action} border-transparent bg-transparent text-ink-muted hover:text-ink`,
    sizes: { ...actionSizes, regular: 'px-3 py-2 text-base' },
  },
  // Secondary action over a photograph: an opaque raised surface, so its ink
  // label reads in both schemes instead of the transparent outline's.
  'on-media': {
    look: `${action} border-transparent bg-surface-raised text-ink hover:bg-surface-sunken`,
    sizes: actionSizes,
  },
  /** An action that ends something: leaving a Round, forfeiting. */
  danger: {
    look: `${action} border-transparent bg-live text-background`,
    sizes: actionSizes,
  },
  /** An action the AI agent takes for the member. */
  ai: {
    look: `${action} border-transparent bg-hue-plum text-background`,
    sizes: actionSizes,
  },
  /** The main action on the stage surface (an incoming challenge). */
  'on-stage': {
    look: `${action} border-transparent bg-stage-accent text-stage-accent-ink`,
    sizes: actionSizes,
  },
  /** The quiet action on the stage surface. */
  'on-stage-quiet': {
    look: `${action} border-transparent bg-transparent text-stage-ink-muted hover:text-stage-ink`,
    sizes: actionSizes,
  },

  // Icon controls.
  /** An icon control, muted until hovered or pressed. */
  icon: {
    look: `${iconShape} text-ink-muted hover:bg-surface-overlay hover:text-ink aria-expanded:bg-surface-overlay aria-pressed:bg-surface-overlay aria-pressed:text-ink`,
    sizes: iconSizes,
  },
  /** An icon control that is the panel's main action (send). */
  'icon-primary': {
    look: `${iconShape} bg-accent text-accent-ink hover:bg-accent-strong`,
    sizes: iconSizes,
  },
  /** The AI agent's send. */
  'icon-ai': {
    look: `${iconShape} bg-hue-plum text-background`,
    sizes: iconSizes,
  },
  /** An icon control on the stage surface. */
  'icon-on-stage': {
    look: `${iconShape} text-stage-ink-muted hover:text-stage-ink`,
    sizes: iconSizes,
  },

  // Rows.
  /** A row in a list, tree or menu. */
  row: { look: `${rowShape} text-ink`, sizes: rowSizes },
  /** A secondary row (back, a status choice): muted until pressed. */
  'row-quiet': {
    look: `${rowShape} text-ink-muted hover:text-ink aria-pressed:text-ink`,
    sizes: rowSizes,
  },
  /** A row whose action destroys something. */
  'row-danger': { look: `${rowShape} text-live`, sizes: rowSizes },
  /** A tree item's own button, filling the row whose chrome the tree draws. */
  'tree-row': {
    look: 'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 pl-1 text-left text-sm disabled:cursor-default',
    sizes: { regular: '' },
  },
  /** A rail item (its look is the rail link's, shared with links). */
  'nav-item': {
    look: 'flex cursor-pointer items-center',
    sizes: {
      regular: navItemShape(false, false),
      extended: navItemShape(false, true),
    },
  },
  /** An item in a rail flyout (shared with the flyout's links). */
  'flyout-item': {
    look: `flex cursor-pointer ${navFlyoutItemShape}`,
    sizes: { regular: '' },
  },

  // Tabs and toggles.
  /** An underlined tab in a tab list; its selected state is `aria-selected`. */
  tab: {
    look: 'inline-flex cursor-pointer items-center justify-center gap-1 border-b-2 border-transparent text-sm text-ink-muted transition-colors hover:text-ink aria-selected:border-accent aria-selected:font-strong aria-selected:text-ink',
    sizes: { regular: '' },
  },
  /** A phone panel tab, icon over label; the current one is `aria-current`. */
  'nav-tab': {
    look: 'relative flex h-12 cursor-pointer flex-col items-center justify-center gap-px text-xs text-ink-muted current:font-strong current:text-accent',
    sizes: { regular: '' },
  },
  /** A document tab's label; the tab around it draws the current state. */
  'doc-tab': {
    look: 'flex h-full cursor-pointer items-center pr-1 pl-3 text-sm whitespace-nowrap',
    sizes: { regular: '' },
  },
  /** One choice of a segmented control in its track; checked is `aria-checked`. */
  segment: {
    look: 'inline-flex cursor-pointer items-center gap-2 rounded-sm border border-transparent bg-transparent px-4 py-2 text-sm font-semibold text-ink-muted transition-colors duration-120 ease-standard hover:text-ink aria-checked:border-border aria-checked:bg-surface-raised aria-checked:text-ink aria-checked:shadow-1',
    sizes: { regular: '' },
  },
  /** A list filter; the applied one is `aria-pressed`. */
  filter: {
    look: 'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-ink',
    sizes: { regular: '' },
  },
  /** A bordered toggle; pressed (`aria-pressed`) fills with the accent. */
  chip: {
    look: 'inline-flex cursor-pointer items-center justify-center gap-1 rounded-round border border-border px-3 text-sm font-strong text-ink transition-colors hover:border-border-strong aria-pressed:border-transparent aria-pressed:bg-accent aria-pressed:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50',
    sizes: { regular: 'min-h-nav-target', room: 'min-h-room-target' },
  },
  /** A selectable card in a list of choices; chosen is `aria-pressed`. */
  'option-card': {
    look: 'block cursor-pointer rounded-lg border border-border p-3 text-left transition-colors hover:bg-surface-raised aria-pressed:border-accent aria-pressed:bg-surface-raised',
    sizes: { regular: '' },
  },
  /** A reaction and its count; the member's own is `aria-pressed`. */
  reaction: {
    look: 'inline-flex h-6 cursor-pointer items-center gap-1 rounded-round border border-border bg-surface-raised px-2 text-xs font-semibold text-ink-muted tabular-nums transition-colors hover:border-border-strong hover:text-ink aria-pressed:border-border-strong aria-pressed:bg-accent-soft aria-pressed:text-ink disabled:cursor-not-allowed disabled:opacity-60',
    sizes: { regular: '' },
  },
  /** A rounded, bordered quick action (a roster command, Latest). */
  pill: {
    look: 'inline-flex cursor-pointer items-center justify-center gap-1 rounded-round border border-border-strong leading-tight font-strong whitespace-nowrap text-ink transition-colors hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-60',
    sizes: {
      regular: 'min-h-room-target px-4 text-sm',
      roster: 'min-h-roster-control px-3 text-sm',
    },
  },
  /** A roster seat: its seat state's tone is the roster's. */
  'seat-box': {
    look: 'flex min-h-roster-control w-full cursor-pointer items-center justify-center rounded-md text-sm font-semibold hover:ring-2 hover:ring-border-strong disabled:cursor-not-allowed',
    sizes: { regular: '' },
  },

  // Text actions.
  /** An inline action in strong type, in its sentence's ink. */
  text: {
    look: 'inline-flex cursor-pointer items-center font-strong disabled:cursor-not-allowed disabled:opacity-60',
    sizes: { regular: '', small: 'text-sm', room: 'min-h-room-target' },
  },
  /** An underlined inline action in its sentence's ink (Reload, Discard). */
  'text-link': {
    look: 'inline-flex cursor-pointer items-center underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
    sizes: {
      regular: '',
      room: 'h-room-target px-3',
      dense: 'h-dense-target px-2',
    },
  },
  /** A small muted text action under content (load more, dismiss). */
  quiet: {
    look: 'min-h-nav-target cursor-pointer text-sm font-semibold text-ink-muted hover:text-ink',
    sizes: { regular: '' },
  },

  // Onboarding's finger-sized actions (its links use them too).
  'touch-primary': {
    look: `${touchShape} border-0 bg-accent text-accent-ink hover:bg-accent-strong`,
    sizes: { regular: '' },
  },
  'touch-secondary': {
    look: `${touchShape} border border-border-strong text-ink`,
    sizes: { regular: '' },
  },
  /** Onboarding's Skip: a quiet, underlined, finger-sized action. */
  'touch-skip': {
    look: 'inline-flex min-h-onboarding-touch cursor-pointer items-center border-0 bg-transparent px-3 text-base text-ink-muted underline underline-offset-4 hover:text-ink disabled:cursor-wait disabled:opacity-60',
    sizes: { regular: '' },
  },
} as const satisfies Record<
  string,
  {
    readonly look: string;
    readonly sizes: { readonly regular: string } & Readonly<
      Record<string, string>
    >;
  }
>;

type Looks = typeof looks;

/** What a button is, which decides its whole look. */
export type ButtonVariant = keyof Looks;

/** The sizes a variant comes in; `regular` is every variant's default. */
export type ButtonSize<V extends ButtonVariant = ButtonVariant> =
  keyof Looks[V]['sizes'] & string;

/** The standard actions: variants that take the action sizes. */
export type ButtonActionVariant = Extract<
  ButtonVariant,
  | 'primary'
  | 'secondary'
  | 'point'
  | 'ghost'
  | 'on-media'
  | 'danger'
  | 'ai'
  | 'on-stage'
  | 'on-stage-quiet'
>;

/** A variant and one of its sizes: what a component that draws a button is handed. */
export type ButtonLook = {
  readonly [V in ButtonVariant]: {
    readonly variant: V;
    readonly size?: ButtonSize<V>;
  };
}[ButtonVariant];

/** Every variant with every size it comes in, for tests and documentation. */
export const buttonSizes = Object.fromEntries(
  Object.entries(looks).map(([variant, { sizes }]) => [
    variant,
    Object.keys(sizes),
  ]),
) as unknown as { readonly [V in ButtonVariant]: readonly ButtonSize<V>[] };

/** Classes for a button of the given variant at the given size (default `regular`). */
export function buttonClass<V extends ButtonVariant>(
  variant: V,
  size?: ButtonSize<V>,
): string {
  const { look, sizes } = looks[variant];
  const table: Readonly<Record<string, string>> = sizes;
  const sized = size === undefined ? sizes.regular : table[size];
  return sized === undefined || sized === '' ? look : `${look} ${sized}`;
}

/** Classes for a variant and size handed over as one look. */
export const lookClass = ({ variant, size }: ButtonLook): string =>
  buttonClass<ButtonVariant>(variant, size as ButtonSize | undefined);
