import Link from 'next/link';
import type { AssignedDebate } from '../../../features/judge/get-assigned';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';

const linkButton = 'no-underline hover:no-underline';

/** Debates assigned to you that still need a ballot. */
export function AssignedDebates({
  debates,
}: {
  readonly debates: readonly AssignedDebate[];
}) {
  if (debates.length === 0) return null;
  return (
    <section
      aria-label="Assigned to you"
      className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
    >
      <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Assigned to you
      </h2>
      <ul className="flex flex-col gap-4">
        {debates.map((debate) => (
          <li
            key={debate.id}
            className="flex flex-wrap items-center justify-between gap-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-md font-strong text-ink">{debate.title}</p>
              <p className="text-base text-ink-muted">{debate.status}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={debate.followHref}
                className={cn(buttonClass('ghost'), linkButton)}
              >
                Follow
              </Link>
              <Link
                href={debate.ballotHref}
                className={cn(buttonClass('primary'), linkButton)}
              >
                Open ballot
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
