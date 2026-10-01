import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../../cn';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';

export type ActionLinkProps = {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly children: ReactNode;
};

/** A navigation that looks like a button: a real link, so it works unhydrated. */
export function ActionLink({
  href,
  variant = 'secondary',
  className,
  children,
}: ActionLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        buttonClass(variant),
        'no-underline hover:no-underline',
        className,
      )}
    >
      {children}
    </Link>
  );
}
