import Link from 'next/link';
import type { Profile } from '../../../features/profile/get-profile';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import {
  heading,
  RatingSummary,
  ResultLine,
} from '../../leaderboard/detail-parts/detail-parts';
import { RatingChart } from '../../leaderboard/rating-chart/rating-chart';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';

function Rating({ profile }: { readonly profile: Profile }) {
  const { detail } = profile;
  if (detail.kind === 'hidden')
    return (
      <p className="flex items-start gap-3 rounded-md bg-surface-overlay p-4 text-base text-ink-muted">
        <Icon name="eye" size={20} />
        Hidden while you judge. Their rating and history return after you submit
        your ballot.
      </p>
    );
  if (detail.kind === 'none')
    return (
      <div className="flex flex-col items-start gap-2 text-base text-ink-muted">
        <p>{detail.text}</p>
        <p className="text-sm text-ink-faint">
          Only ranked debates count toward a rating.
        </p>
      </div>
    );
  return (
    <>
      <RatingSummary
        detail={detail}
        gridClass="grid-cols-4 max-compact:grid-cols-2"
      />
      <RatingChart
        chart={detail.chart}
        label={detail.chartLabel}
        initialStep={detail.step}
        readouts={detail.readouts}
      />
    </>
  );
}

/**
 * A debater's public profile: who they are, their rating and history, the
 * tournaments they have placed in and what they have achieved. Read-only: a
 * member edits their own from Settings.
 */
export function ProfilePage({ profile }: { readonly profile: Profile }) {
  const { detail, extras } = profile;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={profile.username} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
                {`@${profile.username}`}
              </h1>
              {profile.me ? <Badge tone="accent">You</Badge> : null}
              {extras.verified ? <Badge tone="gold">Verified</Badge> : null}
            </div>
            <p className="text-base text-ink-muted">
              {`Member since ${extras.memberSince}`}
              {extras.region ? ` · ${extras.region}` : ''}
            </p>
          </div>
        </div>
        {profile.editHref ? (
          <Link
            href={profile.editHref}
            className={cn(
              buttonClass('secondary'),
              'no-underline hover:no-underline',
            )}
          >
            Edit profile
          </Link>
        ) : null}
      </header>
      <section aria-label="Rating" className={card}>
        <h2 className={heading}>Rating</h2>
        <Rating profile={profile} />
      </section>
      <div className="grid grid-cols-2 items-start gap-6 max-compact:grid-cols-1 max-compact:gap-4">
        <section aria-label="Honours" className={card}>
          <h2 className={heading}>Tournament honours</h2>
          {extras.honours.length === 0 ? (
            <p className="text-base text-ink-muted">
              No tournament honours yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {extras.honours.map((honour) => (
                <li
                  key={honour.detail}
                  className="flex items-center justify-between gap-3 text-base"
                >
                  <span className="font-strong text-ink">{honour.title}</span>
                  <span className="text-ink-muted">{honour.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-ink-faint">
            Honours are recognition only and never change a rating.
          </p>
        </section>
        <section aria-label="Achievements" className={card}>
          <h2 className={heading}>Achievements</h2>
          <ul className="flex flex-col gap-3">
            {extras.achievements.map((achievement) => (
              <li key={achievement.id} className="flex flex-col text-base">
                <span className="font-strong text-ink">
                  {achievement.label}
                </span>
                <span className="text-sm text-ink-muted">
                  {achievement.description}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {detail.kind === 'player' ? (
        <div className="grid grid-cols-2 items-start gap-6 max-compact:grid-cols-1 max-compact:gap-4">
          <section aria-label="Recent results" className={card}>
            <h2 className={heading}>Recent results</h2>
            <ul className="divide-y divide-border">
              {detail.recent.map((row) => (
                <ResultLine key={row.game} row={row} />
              ))}
            </ul>
          </section>
          <section aria-label="Seasons played" className={card}>
            <h2 className={heading}>Seasons played</h2>
            <ul className="divide-y divide-border">
              {detail.seasons.map((row) => (
                <li
                  key={row.label}
                  className={cn(
                    'grid grid-cols-12 items-center gap-3 py-2 text-sm tabular-nums',
                    row.current ? 'font-strong' : 'text-ink-muted',
                  )}
                >
                  <span className="col-span-4">{row.label}</span>
                  <span className="col-span-2 text-right">{row.rating}</span>
                  <span className="col-span-4 text-right">{row.rank}</span>
                  <span className="col-span-2 text-right">{row.record}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
