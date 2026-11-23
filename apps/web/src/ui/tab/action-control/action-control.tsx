import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TabAction } from '../../../features/tab/action';
import { cn } from '../../cn';
import {
  buttonClass,
  type ButtonSize,
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

/** One look for an action and its disabled stand-in: a variant, its size, and what the site adds. */
type Look = {
  readonly variant: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className: string;
};

function Control({
  action,
  about,
  lead,
  look,
}: ActionProps & { readonly look: Look; readonly lead?: ReactNode }) {
  const name = nameOf(action, about);
  return action.kind === 'unavailable' ? (
    <UnavailableControl
      variant={look.variant}
      {...(look.size === undefined ? {} : { size: look.size })}
      className={look.className}
      {...(name === undefined ? {} : { ariaLabel: name })}
    >
      {lead}
      {action.label}
    </UnavailableControl>
  ) : (
    <Link
      href={action.href}
      className={cn(buttonClass(look.variant, look.size), look.className)}
      aria-label={name}
    >
      {lead}
      {action.label}
    </Link>
  );
}

/**
 * A Tab action drawn as a button: a link where there is a page, a disabled
 * button where there is not. Every action is a button (the owner's rule);
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
      look={{
        variant: chosen,
        ...(size === 'small' ? { size: 'row' as const } : {}),
        className: cn(
          'whitespace-nowrap no-underline hover:no-underline',
          className,
        ),
      }}
    />
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
      look={{
        variant: 'text',
        className: cn('text-ink no-underline hover:underline', className),
      }}
    />
  );
}

/**
 * A back link: a small secondary button with a leading arrow. Without an
 * address it is shown disabled, as every unavailable Tab control is.
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
      look={{
        variant: 'secondary',
        size: 'back',
        className: cn(
          'self-start whitespace-nowrap no-underline hover:no-underline',
          className,
        ),
      }}
    />
  );
}
