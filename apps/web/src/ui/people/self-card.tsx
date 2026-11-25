import { Suspense, type ReactNode } from 'react';
import { DismissibleDetails } from '../components/dismissible-details/dismissible-details';
import { cn } from '../cn';
import type { ShellRatings } from '../layout/app-shell/account';
import { profileHref } from '../layout/app-shell/components/destinations';
import { ShellLink as Link } from '../layout/app-shell/shell-link';
import { HeadlineRating } from './self-rating';
import { SelfAvatar } from './status-form';

/** Your card in each place it sits: the people rail, its mini form, the phone's More sheet. */
export type SelfCards = {
  readonly card: ReactNode;
  readonly mini: ReactNode;
  readonly sheet: ReactNode;
};

const panel =
  'absolute z-30 rounded-md border border-border bg-surface-raised p-1 shadow-3';

/**
 * Your own card: one row with your avatar, your name and @username with your
 * one headline rating. The avatar opens your status choices as a native
 * disclosure, so it opens before hydration; the name goes to your profile.
 * Compact, for the mini people rail, is the avatar alone: it opens leftward
 * with your name (to your profile) above your status choices.
 */
export function SelfCard({
  compact = false,
  username,
  displayName,
  photoId,
  ratings,
  statusControl,
}: {
  readonly compact?: boolean;
  readonly username: string;
  readonly displayName: string | null;
  readonly photoId: string | null;
  readonly ratings: Promise<ShellRatings>;
  /** The status form, already wired to its action; absent when unread. */
  readonly statusControl?: ReactNode;
}) {
  const shown = displayName ?? username;
  const avatar = (
    <SelfAvatar name={shown} photoId={photoId} size={compact ? 'sm' : 'md'} />
  );
  const status = statusControl ? (
    <DismissibleDetails
      // The open choices hang from the card, its own width, so they never
      // reach past the rail's edge; the mini rail anchors them to the avatar.
      className={cn('shrink-0', compact && 'relative')}
      summaryClassName="flex size-nav-target cursor-pointer list-none items-center justify-center rounded-full hover:bg-surface-overlay"
      summaryTitle="Your status"
      summary={
        <>
          {/* The name computes from the contents: "Your status, <live status>". */}
          <span className="sr-only">Your status, </span>
          <SelfAvatar
            name={shown}
            photoId={photoId}
            size={compact ? 'sm' : 'md'}
            nameVisible
          />
        </>
      }
    >
      <div
        className={cn(
          panel,
          compact
            ? 'top-0 right-full mr-2 w-flyout'
            : 'inset-x-0 top-full mt-1',
        )}
      >
        {/* The mini rail has no room for the name, so it opens with it. */}
        {compact ? (
          <div className="flex border-b border-border pb-1">
            <Identity shown={shown} username={username} ratings={ratings} />
          </div>
        ) : null}
        {statusControl}
      </div>
    </DismissibleDetails>
  ) : compact ? (
    <Link
      href={profileHref(username)}
      aria-label={`Your profile, ${shown}`}
      className="flex size-nav-target shrink-0 items-center justify-center rounded-full hover:bg-surface-overlay"
    >
      {avatar}
    </Link>
  ) : (
    <span className="flex size-nav-target shrink-0 items-center justify-center">
      {avatar}
    </span>
  );
  if (compact) return status;
  return (
    <section
      aria-label="You"
      className="relative flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-1"
    >
      {status}
      <Identity shown={shown} username={username} ratings={ratings} />
    </section>
  );
}

function Identity({
  shown,
  username,
  ratings,
}: {
  readonly shown: string;
  readonly username: string;
  readonly ratings: Promise<ShellRatings>;
}) {
  return (
    <Link
      href={profileHref(username)}
      className="flex w-0 min-w-0 flex-1 flex-col rounded-md px-1 no-underline hover:bg-surface-overlay hover:no-underline"
    >
      <span className="truncate text-sm font-semibold text-ink">{shown}</span>
      {/* Relative, so the rating's screen-reader words are clipped with the line. */}
      <span className="relative truncate text-xs text-ink-muted">
        @{username}
        <Suspense fallback={null}>
          <HeadlineRating ratings={ratings} />
        </Suspense>
      </span>
    </Link>
  );
}
