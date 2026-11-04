'use client';
import { useEffect } from 'react';
import { useFormAction, type FormAction } from '../form-action/form-action';
import { cn } from '../cn';

export type ReactionPillState = {
  readonly notice?: string;
  /** What the reader's own reaction now is, once the change was accepted. */
  readonly own?: boolean;
};
export type ReactionPillAction = FormAction<ReactionPillState>;

const unavailable = (): ReactionPillState => ({
  notice: 'Reaction could not be changed. Try again.',
});

/**
 * One reaction's shared count, and the reader's own toggle of it: a real POST,
 * so it works before hydration. Hydrated, the answer only updates the reader's
 * own mark, and the count arrives through the shared snapshot.
 */
export function ReactionPill({
  action,
  channelId,
  messageId,
  reaction,
  count,
  own,
  onChanged,
}: {
  readonly action: ReactionPillAction;
  readonly channelId: string;
  readonly messageId: string;
  readonly reaction: string;
  readonly count: number;
  readonly own: boolean;
  readonly onChanged: (reaction: string, own: boolean) => void;
}) {
  const [answer, post, pending] = useFormAction(action, {}, unavailable);
  useEffect(() => {
    if (answer.own !== undefined) onChanged(reaction, answer.own);
  }, [answer, onChanged, reaction]);
  return (
    <form action={post} className="contents">
      <input type="hidden" name="channelId" value={channelId} />
      <input type="hidden" name="messageId" value={messageId} />
      <input type="hidden" name="reaction" value={reaction} />
      <input type="hidden" name="active" value={String(!own)} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={own}
        aria-label={`${reaction} ${count}${own ? ', you reacted. Remove' : '. React'}`}
        title={answer.notice}
        className={cn(
          'inline-flex h-6 cursor-pointer items-center gap-1 rounded-round border px-2 text-xs font-semibold tabular-nums disabled:opacity-60',
          own
            ? 'border-border-strong bg-accent-soft text-ink'
            : 'border-border bg-surface-raised text-ink-muted hover:border-border-strong hover:text-ink',
        )}
      >
        <span aria-hidden="true">{reaction}</span>
        <span aria-hidden="true">{count}</span>
      </button>
    </form>
  );
}
