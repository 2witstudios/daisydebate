import Link from 'next/link';
import type { LiveCard } from '../../../features/watch/live-card';
import { watchRoutes } from '../../../features/watch/routes';
import { StatusLine } from '../../components/status-line/status-line';

/** The home page's way into Watch: real live Rounds, or that there are none. */
export function LiveNow({ rounds }: { readonly rounds: readonly LiveCard[] }) {
  return (
    <section
      aria-label="Live now"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1"
    >
      <h2 className="text-md font-bold text-ink">Live now</h2>
      {rounds.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing live right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rounds.map((round) => (
            <li key={round.id} className="flex items-center gap-2">
              <StatusLine tone="live">{round.mode}</StatusLine>
              <Link href={round.href} className="truncate font-strong">
                {round.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={watchRoutes.hub} className="text-sm font-strong">
        See all live debates
      </Link>
    </section>
  );
}
