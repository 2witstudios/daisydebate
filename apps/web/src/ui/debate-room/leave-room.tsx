'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/icon/icon';
import { FormError } from '../components/form-field/form-field';
import {
  roundCommandUnavailable,
  type RoundFormState,
} from '../../features/round-runtime/command-form';
import { useFormAction, type FormAction } from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';

export type LeaveLinks = {
  /** The server rendered the confirm (no script ran yet). */
  readonly confirming: boolean;
  /** This round without the confirm: where Stay goes. */
  readonly stayHref: string;
  /** This round with the confirm: where Leave room goes without script. */
  readonly confirmHref: string;
  /** Where leaving takes the debater when there is nothing to forfeit. */
  readonly leaveHref: string;
  /**
   * While the Round is live, leaving it forfeits (ADR 0069): Leave posts
   * the round's forfeit command, already confirmed by this dialog.
   */
  readonly forfeit?: {
    readonly action: FormAction<RoundFormState>;
    readonly commandId: string;
    readonly expectedVersion: number;
  };
};

const action =
  'inline-flex h-room-target cursor-pointer items-center justify-center rounded-sm px-4 text-sm font-strong';

const unanswered: RoundFormState = { values: {} };

/** Leave as the confirmed forfeit; it works without script and moves on to the lobby. */
function ForfeitLeave({
  forfeit,
}: {
  readonly forfeit: NonNullable<LeaveLinks['forfeit']>;
}) {
  const [answer, post, pending] = useFormAction(
    forfeit.action,
    unanswered,
    roundCommandUnavailable,
  );
  useMovedOn(answer.next);
  return (
    <form action={post} aria-busy={pending} className="flex flex-col gap-1">
      <input type="hidden" name="version" value="1" />
      <input type="hidden" name="commandId" value={forfeit.commandId} />
      <input
        type="hidden"
        name="expectedVersion"
        value={forfeit.expectedVersion}
      />
      <input type="hidden" name="type" value="forfeit" />
      <input type="hidden" name="confirmed" value="true" />
      <FormError error={answer.error} />
      <button
        type="submit"
        disabled={pending}
        className={`${action} bg-live text-background`}
      >
        Leave and forfeit
      </button>
    </form>
  );
}

/**
 * Leave, far right of the round bar, behind a confirm. Opening and
 * dismissing the confirm are links, so they work without script; with
 * script the confirm opens in place. Leaving a live Round forfeits it.
 */
export function LeaveRoom({ links }: { readonly links: LeaveLinks }) {
  const [open, setOpen] = useState(links.confirming);
  const stay = useRef<HTMLAnchorElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (open) stay.current?.focus();
  }, [open]);
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
        aria-label="Leave room"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        className="ml-2 flex size-room-target shrink-0 items-center justify-center rounded-round border border-live text-live"
      >
        <Icon name="leave" size={18} />
      </a>
      <dialog
        open={open}
        aria-labelledby="leave-room-title"
        onKeyDown={key}
        className="fixed inset-0 z-50 m-auto flex w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 not-open:hidden"
      >
        <h2 id="leave-room-title" className="font-display text-lg">
          Leave the round?
        </h2>
        {links.forfeit ? (
          <p className="text-sm text-ink-muted">
            Leaving now forfeits the round to your opponent.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
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
            <ForfeitLeave forfeit={links.forfeit} />
          ) : (
            <a
              href={links.leaveHref}
              className={`${action} bg-live text-background`}
            >
              Leave
            </a>
          )}
        </div>
      </dialog>
    </>
  );
}
