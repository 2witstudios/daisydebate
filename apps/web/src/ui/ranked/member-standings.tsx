import Link from 'next/link';
import type { MemberStanding } from '../../features/ratings/read-member';

/** Profile and Round use the rating feature's published standing, without local calculation. */
export function MemberStandings({
  standings,
}: {
  readonly standings: readonly MemberStanding[];
}) {
  return (
    <section
      aria-label="Ratings"
      className="flex flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
    >
      <h2 className="text-lg font-bold">Ratings</h2>
      {standings.length === 0 ? (
        <p>No season is active.</p>
      ) : (
        <dl className="flex flex-wrap gap-6">
          {standings.map((s) => (
            <div key={s.ladder}>
              <dt>
                <Link href={`/leaderboard?ladder=${s.ladder}`}>
                  {s.ladder[0]!.toUpperCase() + s.ladder.slice(1)}
                </Link>{' '}
                · {s.season}
              </dt>
              <dd>
                {s.hidden
                  ? 'Hidden while judging'
                  : s.rating === null
                    ? 'Unrated'
                    : `${s.rating}${s.provisional ? ' · Provisional' : ''}`}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
