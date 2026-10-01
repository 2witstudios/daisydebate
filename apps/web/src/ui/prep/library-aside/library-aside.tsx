import Link from 'next/link';
import type {
  SavedSearch,
  TeamSummary,
} from '../../../features/prep/list-library';
import { inertActions } from '../../../features/prep/actions';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import { PrivacyNote } from './privacy-note';

const card = 'flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-1';
const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

export type LibraryAsideProps = {
  readonly savedSearches: readonly SavedSearch[];
  readonly teams: readonly TeamSummary[];
  /** True before the owner has anything: the cards explain themselves. */
  readonly empty?: boolean;
};

/** Saved searches, teams and the privacy note beside the library. */
export function LibraryAside({
  savedSearches,
  teams,
  empty = false,
}: LibraryAsideProps) {
  return (
    <aside
      aria-label="Library"
      className="flex w-rail shrink-0 flex-col gap-5 max-rail:w-full"
    >
      <section className={card}>
        <h2 className={heading}>Saved searches</h2>
        {empty ? (
          <p className="text-sm text-ink-muted">
            Run a search with filters, then choose Save this search. It will
            wait here.
          </p>
        ) : (
          <ul>
            {savedSearches.map((saved) => (
              <li key={saved.id}>
                <Link
                  href={saved.href}
                  className="flex min-h-12 items-center gap-3 text-base text-ink no-underline hover:no-underline"
                >
                  <PrepIcon
                    name="bookmark"
                    size={16}
                    className="text-ink-faint"
                  />
                  <span className="flex-1">{saved.name}</span>
                  <span className="text-sm text-ink-faint tabular-nums">
                    {saved.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={card}>
        <h2 className={heading}>Teams</h2>
        {empty ? (
          <>
            <p className="text-sm text-ink-muted">
              Teams share briefs and cases you choose. Nothing is shared until
              you do it.
            </p>
            <InertActionButton action={inertActions.createOrJoinTeam} />
          </>
        ) : (
          <>
            <ul>
              {teams.map((team) => (
                <li key={team.id}>
                  <Link
                    href={`/prep/teams/${team.id}`}
                    className="flex min-h-16 items-center gap-3 text-ink no-underline hover:no-underline"
                  >
                    <span className="inline-flex -space-x-2">
                      {team.memberHandles.slice(0, 3).map((handle) => (
                        <Avatar
                          key={handle}
                          name={handle}
                          size="sm"
                          nameVisible
                        />
                      ))}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-base font-strong">{team.name}</span>
                      <span className="text-sm text-ink-muted">
                        {`${team.memberHandles.length} members · ${team.sharedCount} shared items`}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </Link>
                </li>
              ))}
            </ul>
            <InertActionButton
              action={inertActions.createOrJoinTeam}
              variant="ghost"
            />
          </>
        )}
      </section>
      <PrivacyNote>
        Your library is private to you. Teammates see only what you share with
        them. Opponents and spectators never see it.
      </PrivacyNote>
    </aside>
  );
}
