import Link from 'next/link';
import { judgeRoutes } from '../../../features/judge/routes';

/** The way back to the Judge hub from any of its screens. */
export function BackLink() {
  return (
    <Link
      href={judgeRoutes.hub}
      className="inline-flex items-center gap-2 text-base font-strong text-ink-muted no-underline hover:text-ink hover:no-underline"
    >
      <span aria-hidden="true">←</span>
      Judge
    </Link>
  );
}
