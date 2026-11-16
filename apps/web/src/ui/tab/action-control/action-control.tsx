import { WalkLink as Link } from '../walk/walk-link';
import type { ReactNode } from 'react';
import type { TabAction } from '../../../features/tab/action';
import { cn } from '../../cn';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { UnavailableControl } from './unavailable-control';
import { linkTo, unavailableAction } from '../../../features/tab/action';

type ActionProps = {
  readonly action: TabAction;
  /** What the control acts on, where its label alone repeats down a list. */
  readonly about?: string;
  readonly className?: string;
};

/** One accessible name that starts with the visible label (WCAG label in name). */
const nameOf = (action: TabAction, about: string | undefined) =>
  about === undefined ? undefined : `${action.label}: ${about}`;

function Control({
  action,
  about,
  lead,
  className,
}: ActionProps & { readonly className: string; readonly lead?: ReactNode }) {
  const name = nameOf(action, about);
  return action.kind === 'unavailable' ? (
    <UnavailableControl
      label={action.label}
      className={className}
      {...(name === undefined ? {} : { ariaLabel: name })}
    >
      {lead}
      {action.label}
    </UnavailableControl>
  ) : (
    <Link href={action.href} className={className} aria-label={name}>
      {lead}
      {action.label}
    </Link>
  );
}

/** The compact sizes of a Tab button: `row` for row actions, list expanders and header actions, `back` for back links. */
type CompactSize = 'row' | 'back';
const compact: Readonly<Record<CompactSize, string>> = {
  row: 'min-h-12 px-3 text-base',
  back: 'min-h-10 px-3 text-sm',
};

/**
 * The app's button at a compact Tab size. The shared button owns its padding
 * and type size, so they are swapped here rather than overridden, keeping one
 * value per property on the element.
 */
export const compactButtonClass = (
  variant: ButtonVariant,
  size: CompactSize,
): string =>
  buttonClass(variant)
    .replace('px-5 py-3', compact[size])
    .replace(' text-base ', ' ');

/**
 * A Tab action drawn as a button: a link where there is a page, a sample
 * action where there is not. Every action is a button (the owner's rule);
 * `size="small"` is the compact one rows and lists use.
 */
export function ActionButton({
  action,
  about,
  variant,
  size,
  className,
}: ActionProps & {
  readonly variant?: ButtonVariant;
  readonly size?: 'small';
}) {
  const chosen = variant ?? (action.primary ? 'primary' : 'secondary');
  return (
    <Control
      action={action}
      {...(about === undefined ? {} : { about })}
      className={cn(
        size === 'small'
          ? compactButtonClass(chosen, 'row')
          : buttonClass(chosen),
        'whitespace-nowrap no-underline hover:no-underline',
        className,
      )}
    />
  );
}

/** The mark an in-sentence link carries, so a test can tell it from an action drawn as a link. */
export const sentenceLinkMark = 'data-sentence-link';

/**
 * An action as a text link, only where it reads as part of a sentence
 * ("Round 3: you won. … Watch it back"). Anywhere else an action is an
 * `ActionButton`; the walk test fails on an underlined link without this mark.
 */
export function SentenceLink({ action, about, className }: ActionProps) {
  return (
    <span {...{ [sentenceLinkMark]: '' }} className="contents">
      <Control
        action={action}
        {...(about === undefined ? {} : { about })}
        className={cn('font-strong text-ink underline', className)}
      />
    </span>
  );
}

/**
 * An action that is a row's own title (a name on a ladder opening its
 * profile): the title in bold ink, not a button and not an underlined link.
 */
export function TitleLink({ action, about, className }: ActionProps) {
  return (
    <Control
      action={action}
      {...(about === undefined ? {} : { about })}
      className={cn(
        'font-strong text-ink no-underline hover:underline',
        className,
      )}
    />
  );
}

/**
 * A back link: a small secondary button with a leading arrow. Without an
 * address it answers as a sample action, as every Tab control does.
 */
export function BackButton({
  href,
  label,
  className,
}: {
  readonly href: string | null;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <Control
      action={href === null ? unavailableAction(label) : linkTo(label, href)}
      lead={<span aria-hidden="true">←</span>}
      className={cn(
        compactButtonClass('secondary', 'back'),
        'self-start whitespace-nowrap no-underline hover:no-underline',
        className,
      )}
    />
  );
}
