import type { ReactNode } from 'react';
import Link from 'next/link';
import type {
  JudgePanel,
  MatchHistoryEntry,
  MemberProfile,
  RecordResult,
} from '@daisy/protocol';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import type { BadgeTone } from '../../components/badge/badge-class';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { MediaPageLink } from '../../round-media/media-page-link';
import { ProfileActions } from '../profile-actions/profile-actions';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

const month = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const results: Readonly<
  Record<RecordResult, { readonly label: string; readonly tone: BadgeTone }>
> = {
  win: { label: 'Won', tone: 'accent' },
  loss: { label: 'Lost', tone: 'clay' },
  draw: { label: 'Draw', tone: 'sky' },
  'no-ruling': { label: 'No ruling', tone: 'neutral' },
};

const judges: Readonly<Record<JudgePanel, string>> = {
  ai: 'AI judge',
  human: 'Human judges',
  mixed: 'AI and human judges',
  none: 'No judge',
};

const sides = { affirmative: 'Affirmative', negative: 'Negative' } as const;

function Opponents({ entry }: { readonly entry: MatchHistoryEntry }) {
  if (entry.opponents.length === 0) return <span>No opponent</span>;
  return (
    <span>
      {'vs '}
      {entry.opponents.map((opponent, index) => (
        <span key={index}>
          {index > 0 ? ', ' : ''}
          {opponent.label === null ? (
            'Former member'
          ) : opponent.kind === 'bot' ? (
            `${opponent.label} (AI)`
          ) : (
            <Link
              href={`/profile/${opponent.label}`}
            >{`@${opponent.label}`}</Link>
          )}
        </span>
      ))}
    </span>
  );
}

function HistoryRow({
  entry,
  me,
}: {
  readonly entry: MatchHistoryEntry;
  readonly me: boolean;
}) {
  const result = results[entry.result];
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MediaPageLink
          href={`/rounds/${entry.roundId}`}
          className="min-w-0 font-strong text-ink"
        >
          {entry.resolution}
        </MediaPageLink>
        <span className="flex items-center gap-2">
          {me && entry.visibility !== 'public' ? (
            <Badge>{entry.visibility}</Badge>
          ) : null}
          <Badge tone={result.tone}>{result.label}</Badge>
        </span>
      </div>
      <p className="flex flex-wrap gap-x-2 text-sm text-ink-muted">
        <time dateTime={entry.completedAt}>{day(entry.completedAt)}</time>
        <span aria-hidden="true">·</span>
        <span>{sides[entry.side]}</span>
        <span aria-hidden="true">·</span>
        <Opponents entry={entry} />
        <span aria-hidden="true">·</span>
        <span>{entry.forfeit ? 'By forfeit' : judges[entry.judges]}</span>
      </p>
    </li>
  );
}

function RecordSummary({ profile }: { readonly profile: MemberProfile }) {
  const { wins, losses, draws } = profile.record;
  const figures = [
    { label: 'Wins', value: wins },
    { label: 'Losses', value: losses },
    ...(draws > 0 ? [{ label: 'Draws', value: draws }] : []),
  ];
  return (
    <section aria-label="Record" className={card}>
      <h2 className={heading}>Record</h2>
      <dl className="flex flex-wrap gap-8">
        {figures.map((figure) => (
          <div key={figure.label} className="flex flex-col">
            <dt className="text-sm text-ink-muted">{figure.label}</dt>
            <dd className="font-display text-3xl font-bold tabular-nums">
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">
        From completed rounds. Rounds with no ruling are listed but not counted.
      </p>
    </section>
  );
}

/**
 * A member's profile: who they are, their record and the rounds they have
 * debated. Only real data: everything here comes from the profile read.
 */
export function ProfilePage({
  profile,
  paged,
  actions,
}: {
  readonly profile: MemberProfile;
  /** Whether this is an older page of the history. */
  readonly paged: boolean;
  /** The viewer's actions toward this member, if any. */
  readonly actions?: ReactNode;
}) {
  const base = `/profile/${profile.username}`;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={profile.username} size="lg" nameVisible />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
                {`@${profile.username}`}
              </h1>
              {profile.me ? <Badge tone="accent">You</Badge> : null}
            </div>
            <p className="text-base text-ink-muted">
              {`Member since ${month(profile.memberSince)}`}
            </p>
          </div>
        </div>
        <ProfileActions username={profile.username} me={profile.me}>
          {actions}
        </ProfileActions>
      </header>
      <RecordSummary profile={profile} />
      <section aria-label="Match history" className={card}>
        <h2 className={heading}>Match history</h2>
        {profile.history.length === 0 ? (
          <p className="text-base text-ink-muted">
            {paged
              ? 'No older rounds.'
              : profile.me
                ? 'You have no completed rounds yet.'
                : 'No public rounds yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {profile.history.map((entry) => (
              <HistoryRow key={entry.roundId} entry={entry} me={profile.me} />
            ))}
          </ul>
        )}
        {paged || profile.nextBefore ? (
          <nav
            aria-label="Match history pages"
            className="flex flex-wrap gap-2"
          >
            {paged ? (
              <Link
                href={base}
                className={cn(
                  buttonClass('secondary'),
                  'no-underline hover:no-underline',
                )}
              >
                Newest rounds
              </Link>
            ) : null}
            {profile.nextBefore ? (
              <Link
                href={`${base}?before=${profile.nextBefore}`}
                className={cn(
                  buttonClass('secondary'),
                  'no-underline hover:no-underline',
                )}
              >
                Older rounds
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
