import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';

/**
 * The actions row in a profile's header. The owner edits their profile from
 * Settings; actions toward another member (befriend, challenge, message)
 * join this row beside it.
 */
export function ProfileActions({
  username,
  me,
  children,
}: {
  readonly username: string;
  readonly me: boolean;
  /** Actions toward this member, which the viewer's own relations decide. */
  readonly children?: ReactNode;
}) {
  return (
    <div
      aria-label={me ? 'Your profile actions' : `Actions for @${username}`}
      role="group"
      className="flex flex-wrap items-center gap-2"
    >
      {me ? (
        <Link
          href="/settings"
          className={cn(
            buttonClass('secondary'),
            'no-underline hover:no-underline',
          )}
        >
          Edit profile
        </Link>
      ) : (
        children
      )}
    </div>
  );
}
