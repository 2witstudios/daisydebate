import Link from 'next/link';
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
}: {
  readonly username: string;
  readonly me: boolean;
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
      ) : null}
    </div>
  );
}
