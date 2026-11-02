'use client';

import type { ChallengeList } from '@daisy/protocol';
import { useEffect, useRef } from 'react';
import { challengeFormUnavailable } from '../../features/challenges/forms';
import { cn } from '../cn';
import { useFormAction } from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { useOnline } from './online-provider';
import type { PersonActions } from './person-actions';

const labels = {
  freestyle: 'Freestyle',
  policy: 'Policy',
  value: 'Value',
  ranked: 'Ranked',
  casual: 'Casual',
} as const;

const summaryOf = (offer: ChallengeList['incoming'][number]) =>
  `${labels[offer.format]} · ${labels[offer.mode]}`;

const stageAccept =
  'min-h-nav-target rounded-sm bg-stage-accent px-4 text-sm font-bold text-stage-accent-ink disabled:opacity-60';
const stageDecline =
  'min-h-nav-target rounded-sm px-3 text-sm font-semibold text-stage-ink-muted hover:text-stage-ink';

function IncomingCard({
  offer,
  actions,
  className,
}: {
  readonly offer: ChallengeList['incoming'][number];
  readonly actions: PersonActions;
  readonly className?: string;
}) {
  const { refresh } = useOnline();
  const [accepted, accept, accepting] = useFormAction(
    actions.acceptChallenge,
    {},
    challengeFormUnavailable,
  );
  const [declined, decline, declining] = useFormAction(
    actions.endChallenge,
    {},
    challengeFormUnavailable,
  );
  useMovedOn(accepted.next);
  const initial = useRef(declined);
  useEffect(() => {
    if (declined !== initial.current) refresh();
  }, [declined, refresh]);
  const notice = accepted.notice ?? declined.notice;
  return (
    <section
      aria-label={`Challenge from @${offer.username}`}
      className={cn(
        'flex flex-col gap-1 rounded-lg bg-surface-stage px-4 py-3 text-stage-ink',
        className,
      )}
    >
      <p className="text-xs font-bold tracking-wide text-stage-ink-muted uppercase">
        Challenge
      </p>
      <p className="font-display text-lg leading-tight font-semibold">
        @{offer.username}
      </p>
      <p className="text-sm text-stage-ink-muted">{summaryOf(offer)}</p>
      {notice ? (
        <p role="status" className="text-sm text-stage-ink-muted">
          {notice}
        </p>
      ) : null}
      <div className="mt-1 flex gap-1">
        <form action={accept}>
          <input type="hidden" name="challengeId" value={offer.id} />
          <button
            type="submit"
            disabled={accepting || accepted.next !== undefined}
            className={stageAccept}
          >
            Accept
          </button>
        </form>
        <form action={decline}>
          <input type="hidden" name="command" value="decline" />
          <input type="hidden" name="challengeId" value={offer.id} />
          <button type="submit" disabled={declining} className={stageDecline}>
            Decline
          </button>
        </form>
      </div>
    </section>
  );
}

/** Where a challenger goes once they were accepted; a document load for the room's media policy. */
function AcceptedCard({
  offer,
  className,
}: {
  readonly offer: ChallengeList['accepted'][number];
  readonly className?: string;
}) {
  return (
    <section
      aria-label={`@${offer.username} accepted`}
      className={cn(
        'flex flex-col gap-1 rounded-lg bg-surface-stage px-4 py-3 text-stage-ink',
        className,
      )}
    >
      <p className="text-sm text-stage-ink-muted">@{offer.username} accepted</p>
      <a
        href={`/rooms/${offer.roomId}`}
        className={cn(
          stageAccept,
          'inline-flex items-center self-start no-underline',
        )}
      >
        Go to room
      </a>
    </section>
  );
}

const FOLLOWED_KEY = 'daisy.followed-room';
const followedRoom = () => {
  try {
    return localStorage.getItem(FOLLOWED_KEY);
  } catch {
    return null;
  }
};
const rememberFollowed = (roomId: string) => {
  try {
    localStorage.setItem(FOLLOWED_KEY, roomId);
  } catch {
    // Without storage the short follow window is the only limit.
  }
};

/**
 * Takes a challenger to the room the moment they are accepted, once per room,
 * so leaving it never pulls them back. A member already in a room stays put.
 */
function useFollowAccepted(
  accepted: ChallengeList['accepted'],
  activeRoomId: string | null,
) {
  useEffect(() => {
    if (activeRoomId !== null) return;
    const offer = accepted.find((row) => row.roomId !== followedRoom());
    if (!offer) return;
    rememberFollowed(offer.roomId);
    if (!window.location.pathname.startsWith(`/rooms/${offer.roomId}`))
      window.location.assign(`/rooms/${offer.roomId}`);
  }, [accepted, activeRoomId]);
}

/** Renders nothing: one follower for the tab, however many cards are mounted. */
export function FollowAccepted({
  activeRoomId,
}: {
  readonly activeRoomId: string | null;
}) {
  const { challenges } = useOnline();
  useFollowAccepted(challenges.accepted, activeRoomId);
  return null;
}

/**
 * Whatever challenges wait on this member, wherever they are on Daisy: at the
 * top of the open rail, flown out of the collapsed one, or over a phone's tabs.
 */
export function ChallengeCards({
  actions,
  activeRoomId,
  className,
  cardClassName,
}: {
  readonly actions: PersonActions;
  readonly activeRoomId: string | null;
  readonly className?: string;
  readonly cardClassName?: string;
}) {
  const { challenges } = useOnline();
  const accepted = challenges.accepted.filter(
    (offer) => offer.roomId !== activeRoomId,
  );
  if (challenges.incoming.length === 0 && accepted.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {accepted.map((offer) => (
        <AcceptedCard
          key={offer.id}
          offer={offer}
          {...(cardClassName ? { className: cardClassName } : {})}
        />
      ))}
      {challenges.incoming.slice(0, 3).map((offer) => (
        <IncomingCard
          key={offer.id}
          offer={offer}
          actions={actions}
          {...(cardClassName ? { className: cardClassName } : {})}
        />
      ))}
    </div>
  );
}
