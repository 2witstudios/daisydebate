'use client';
import { useCallback } from 'react';
import { useFormAction, type FormAction } from '../form-action/form-action';
import {
  initialReactionPill,
  reactionPillFields,
  reactionPillUnavailable,
  type ReactionPillState,
} from '../../features/messaging/forms/reaction-pill-form';
import { cn } from '../cn';

export type ReactionPillAction = FormAction<ReactionPillState>;

/**
 * One reaction's shared count, and the reader's own toggle of it: a real POST,
 * so it works before hydration. Live counts arrive through shared snapshots;
 * an HTTP-only history view uses the authorized action's accepted count.
 */
export function ReactionPill({
  action,
  channelId,
  messageId,
  reaction,
  count,
  own,
  onChanged,
  observed = true,
}: {
  readonly action: ReactionPillAction;
  readonly channelId: string;
  readonly messageId: string;
  readonly reaction: string;
  readonly count: number;
  readonly own: boolean;
  readonly onChanged: (reaction: string, own: boolean) => void;
  readonly observed?: boolean;
}) {
  const change = useCallback<ReactionPillAction>(
    async (previous, form) => {
      const accepted = await action(previous, form);
      // A live count can remove this pill before its action response arrives.
      // Keep the reader's mark in the parent even if this child has unmounted.
      const { own: changed } = reactionPillFields(accepted);
      if (changed !== undefined) onChanged(reaction, changed);
      return accepted;
    },
    [action, onChanged, reaction],
  );
  const [answer, post, pending] = useFormAction(
    typeof window === 'undefined' ? action : change,
    initialReactionPill,
    reactionPillUnavailable,
  );
  const fields = reactionPillFields(answer);
  const shownCount = observed ? count : (fields.count ?? count);
  if (shownCount === 0) return null;
  return (
    <form action={post} className="contents">
      <input type="hidden" name="channelId" value={channelId} />
      <input type="hidden" name="messageId" value={messageId} />
      <input type="hidden" name="reaction" value={reaction} />
      <input type="hidden" name="observed" value={String(observed)} />
      <input type="hidden" name="active" value={String(!own)} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={own}
        aria-label={`${reaction} ${shownCount}${own ? ', you reacted. Remove' : '. React'}`}
        title={fields.notice}
        className={cn(
          'inline-flex h-6 cursor-pointer items-center gap-1 rounded-round border px-2 text-xs font-semibold tabular-nums disabled:opacity-60',
          own
            ? 'border-border-strong bg-accent-soft text-ink'
            : 'border-border bg-surface-raised text-ink-muted hover:border-border-strong hover:text-ink',
        )}
      >
        <span aria-hidden="true">{reaction}</span>
        <span aria-hidden="true">{shownCount}</span>
      </button>
    </form>
  );
}
