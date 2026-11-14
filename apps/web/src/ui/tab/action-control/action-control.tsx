import Link from 'next/link';
import type { TabAction } from '../../../features/tab/action';
import { cn } from '../../cn';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { SampleAction } from '../../components/sample-action/sample-action';

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
  className,
}: ActionProps & { readonly className: string }) {
  const name = nameOf(action, about);
  return action.href === null ? (
    <SampleAction
      label={action.label}
      className={className}
      {...(name === undefined ? {} : { ariaLabel: name })}
    >
      {action.label}
    </SampleAction>
  ) : (
    <Link href={action.href} className={className} aria-label={name}>
      {action.label}
    </Link>
  );
}

/** A Tab action drawn as a button: a link where there is a page, a sample action where there is not. */
export function ActionButton({
  action,
  about,
  variant,
  className,
}: ActionProps & { readonly variant?: ButtonVariant }) {
  return (
    <Control
      action={action}
      {...(about === undefined ? {} : { about })}
      className={cn(
        buttonClass(variant ?? (action.primary ? 'primary' : 'secondary')),
        'whitespace-nowrap no-underline hover:no-underline',
        className,
      )}
    />
  );
}

/** The same action as a text link. */
export function ActionLink({ action, about, className }: ActionProps) {
  return (
    <Control
      action={action}
      {...(about === undefined ? {} : { about })}
      className={cn('font-strong text-ink underline', className)}
    />
  );
}
