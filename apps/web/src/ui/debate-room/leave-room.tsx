'use client';

import { useBrowserEffect } from '../edge/browser-sync';
import { useFocusWhen } from '../edge/use-focus';
import { Button } from '../components/button/button';
import { Dialog } from '../components/dialog/dialog';
import { StatusRegion } from '../components/status-region/status-region';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/icon/icon';
import { FormError } from '../components/form-field/form-field';
import {
  roundCommandUnavailable,
  roundFormFields,
  type RoundFormState,
} from '../../features/round-runtime/command-form';
import { destinationOf, idle } from '../../features/forms/form-state';
import { useFormAction, type FormAction } from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { leaveRound } from '../../features/rooms/resume-departure';
import { clearRoundMediaPreferences } from '../../features/round-media/media-preferences';

export type LeaveLinks = {
  /** The server rendered the confirm (not hydrated yet). */
  readonly confirming: boolean;
  /** This round without the confirm: where Stay goes. */
  readonly stayHref: string;
  /** This round with the confirm: where Leave round goes before hydration. */
  readonly confirmHref: string;
  /** Where leaving takes the debater when there is nothing to forfeit. */
  readonly leaveHref: string;
  /**
   * A debater after the last speech while the Round awaits its ballot: the
   * Room no longer holds them, and leaving forfeits nothing (ISSUE-590).
   */
  readonly freed?: boolean;
  /** The Round is over and this is its post-round call (ADR 0127): leaving leaves the call. */
  readonly call?: boolean;
  /**
   * A debater still seated while forfeit is briefly unavailable: nothing can
   * confirm a departure yet, so the only exit keeps the seat (ISSUE-879).
   */
  readonly held?: boolean;
  /**
   * Whose departure this is (ISSUE-879): the member who confirmed leaves
   * this tab's auto-resume for that Round, and any tab waiting on it
   * (ISSUE-1033); nothing server-side can re-suppress it.
   */
  readonly left?: {
    readonly actorId: string | null;
    readonly roundId: string;
    readonly roomId: string;
  };
  /**
   * While the Round is live, leaving it forfeits (ADR 0070): Leave posts
   * the round's forfeit command, already confirmed by this dialog. In a
   * Round no forfeit ends it posts `leave` instead: the seat is recorded
   * absent and the Round goes on without it (TAB-6.8).
   */
  readonly forfeit?: {
    readonly action: FormAction<RoundFormState>;
    readonly commandId: string;
    readonly expectedVersion: number;
    /** The leaving debater's own seat, which the forfeit names. */
    readonly participantId: string;
    /** The command Leave posts; a forfeit unless the Round cannot be forfeited. */
    readonly type?: 'forfeit' | 'leave';
  };
};

const action =
  'inline-flex h-room-target cursor-pointer items-center justify-center rounded-sm px-4 text-sm font-strong';

const unanswered: RoundFormState = idle();

/** Leave as the confirmed forfeit (or absence); it works before hydration and moves on. */
function ForfeitLeave({
  forfeit,
  left,
}: {
  readonly forfeit: NonNullable<LeaveLinks['forfeit']>;
  readonly left?: LeaveLinks['left'];
}) {
  const [answer, post, pending] = useFormAction(
    forfeit.action,
    unanswered,
    roundCommandUnavailable,
  );
  /**
   * Suppression records only an acknowledged forfeit (ISSUE-879), which
   * is the one answer that moves on: a refused, conflicted or unknown
   * outcome leaves the participant's recovery exactly as live as their
   * membership still is.
   */
  useBrowserEffect(() => {
    if (!pending && answer.kind === 'moved' && left) {
      leaveRound(left.actorId, left.roundId);
      clearRoundMediaPreferences(left.actorId, left.roomId, left.roundId);
    }
  }, [pending, answer, left]);
  useMovedOn(destinationOf(answer));
  return (
    <form action={post} aria-busy={pending} className="flex flex-col gap-1">
      <input type="hidden" name="version" value="1" />
      <input type="hidden" name="commandId" value={forfeit.commandId} />
      <input
        type="hidden"
        name="expectedVersion"
        value={forfeit.expectedVersion}
      />
      <input type="hidden" name="type" value={forfeit.type ?? 'forfeit'} />
      <input type="hidden" name="participantId" value={forfeit.participantId} />
      <input type="hidden" name="confirmed" value="true" />
      <FormError error={roundFormFields(answer).error} />
      <Button
        variant="unstyled"
        type="submit"
        disabled={pending}
        className={`${action} bg-live text-background`}
      >
        {forfeit.type === 'leave' ? 'Leave round' : 'Leave and forfeit'}
      </Button>
    </form>
  );
}

/**
 * Leave, far right of the round bar, behind a confirm. Opening and
 * dismissing the confirm are links, so they work before hydration; with
 * script the confirm opens in place. Leaving a live Round forfeits it.
 */
function LeavePermanent({
  links,
  className,
  children,
}: {
  readonly links: LeaveLinks & {
    readonly left: NonNullable<LeaveLinks['left']>;
  };
  readonly className?: string;
  readonly children: string;
}) {
  return (
    <a
      href={links.leaveHref}
      className={className}
      onClick={() => {
        leaveRound(links.left.actorId, links.left.roundId);
        clearRoundMediaPreferences(
          links.left.actorId,
          links.left.roomId,
          links.left.roundId,
        );
      }}
    >
      {children}
    </a>
  );
}

/** A stalled Round must not trap anyone: this leaves the page and keeps the seat. */
function StepAway({
  left,
}: {
  readonly left: NonNullable<LeaveLinks['left']>;
}) {
  return (
    <a
      href="/lobby"
      className={`${action} border border-border-strong text-ink`}
      onClick={() => leaveRound(left.actorId, left.roundId)}
    >
      Go to the lobby, keeping your seat
    </a>
  );
}

export function LeaveRoom({ links }: { readonly links: LeaveLinks }) {
  const [open, setOpen] = useState(links.confirming);
  const leaveLabel = links.call ? 'Leave call' : 'Leave round';
  const stay = useRef<HTMLAnchorElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  useFocusWhen(stay, open);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const key = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };
  return (
    <>
      <a
        ref={trigger}
        href={links.confirmHref}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        className="ml-2 flex h-room-target shrink-0 items-center justify-center gap-2 rounded-round border border-live px-4 text-sm font-strong text-live"
      >
        <Icon name="leave" size={16} />
        <span className="max-narrow:sr-only">{leaveLabel}</span>
      </a>
      <Dialog
        open={open}
        aria-labelledby="leave-room-title"
        onKeyDown={key}
        className="fixed inset-0 z-50 m-auto flex w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 not-open:hidden"
      >
        <h2 id="leave-room-title" className="font-display text-lg">
          {links.call ? 'Leave the call?' : 'Leave the round?'}
        </h2>
        {links.forfeit?.type === 'leave' ? (
          <p className="text-sm text-ink-muted">
            The round continues without you: your seat is recorded absent for
            the rest of the debate.
          </p>
        ) : links.forfeit ? (
          <p className="text-sm text-ink-muted">
            Leaving now forfeits the round to your opponent.
          </p>
        ) : links.freed ? (
          <p className="text-sm text-ink-muted">
            {links.call
              ? 'The round is over, so leaving forfeits nothing.'
              : 'The debate is over, so leaving forfeits nothing.'}
          </p>
        ) : links.held ? (
          <StatusRegion as="p" role="status" className="text-sm text-ink-muted">
            Leaving is unavailable for a moment while this round catches up. You
            can step away, but this is not leaving: the round continues, your
            seat stays, and the normal attendance rules apply if you are absent.
          </StatusRegion>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <a
            ref={stay}
            href={links.stayHref}
            onClick={(event) => {
              event.preventDefault();
              close();
            }}
            className={`${action} border border-border-strong text-ink`}
          >
            Stay
          </a>
          {links.forfeit ? (
            <ForfeitLeave forfeit={links.forfeit} left={links.left} />
          ) : links.held ? (
            links.left ? (
              <StepAway left={links.left} />
            ) : null
          ) : links.left ? (
            <LeavePermanent
              links={
                links as LeaveLinks & { left: NonNullable<LeaveLinks['left']> }
              }
              className={`${action} bg-live text-background`}
            >
              {leaveLabel}
            </LeavePermanent>
          ) : (
            <a
              href={links.leaveHref}
              className={`${action} bg-live text-background`}
            >
              {leaveLabel}
            </a>
          )}
        </div>
      </Dialog>
    </>
  );
}
