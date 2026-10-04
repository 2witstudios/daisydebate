import Link from 'next/link';
import { signInHref } from '../../../../features/access/decision';
import type { YourTournament } from '../../../../features/tournaments/list-tournaments';
import { tournamentRoutes } from '../../../../features/tournaments/routes';
import { statusOf } from '../../../../features/tournaments/tournament';
import { LinkButton } from '../../link-button/link-button';
import { StatusBadge } from '../../status-badge/status-badge';

const entryBadge = (item: YourTournament): string | null =>
  item.entry.kind === 'registered'
    ? 'Registered'
    : item.entry.kind === 'waitlisted'
      ? `Waitlist ${item.entry.position} of ${item.tournament.waitlisted}`
      : null;

function YourItem({ item }: { readonly item: YourTournament }) {
  const { tournament, entry } = item;
  const badge = entryBadge(item);
  return (
    <li className="flex flex-col gap-2 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={tournamentRoutes.detail(tournament.id)}
          className="font-strong text-ink"
        >
          {tournament.name}
        </Link>
        {badge ? (
          <span className="text-xs font-bold tracking-wider text-ink-muted uppercase">
            {badge}
          </span>
        ) : (
          <StatusBadge status={statusOf(tournament)} />
        )}
      </div>
      <p className="text-sm text-ink-muted">{entry.note}</p>
      {entry.kind === 'competing' ? (
        <LinkButton
          href={tournamentRoutes.myEvent(tournament.id)}
          variant="primary"
        >
          Open my event
        </LinkButton>
      ) : null}
    </li>
  );
}

const section = 'rounded-xl bg-surface p-6 shadow-1';
const heading =
  'mb-4 text-xs font-bold tracking-widest text-ink-muted uppercase';

/** The side column: your tournaments, organizing and judging. */
export function YourTournaments({
  yours,
  signedIn,
}: {
  readonly yours: readonly YourTournament[];
  readonly signedIn: boolean;
}) {
  return (
    <aside aria-label="Your tournaments" className="flex flex-col gap-4">
      <section className={section}>
        <h2 className={heading}>Your tournaments</h2>
        {!signedIn ? (
          <LinkButton href={signInHref(tournamentRoutes.index)}>
            Sign in
          </LinkButton>
        ) : yours.length === 0 ? (
          <p className="text-base text-ink-muted">None yet</p>
        ) : (
          <ul>
            {yours.map((item) => (
              <YourItem key={item.tournament.id} item={item} />
            ))}
          </ul>
        )}
      </section>
      <section className={section}>
        <h2 className={heading}>Organize</h2>
        <LinkButton href={tournamentRoutes.create}>
          Create a tournament
        </LinkButton>
      </section>
    </aside>
  );
}
