'use client';

import { useEffect, useRef } from 'react';
import {
  floorFormUnavailable,
  type FloorFormState,
} from '../../features/messaging/round-floor/form';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { CountedTextarea } from '../messaging/counted-textarea';
import { Icon } from '../components/icon/icon';

/** Command identity survives refusals and unknown results; a confirmed answer alone rotates it. */
export function FloorComposer({
  id,
  initial,
  action,
  maxUnits,
  onSent,
  locked = false,
}: {
  readonly id: string;
  readonly initial: FloorFormState;
  readonly action: FormAction<FloorFormState>;
  readonly maxUnits: number;
  readonly locked?: boolean;
  readonly onSent: (messageId: string) => void;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initial,
    floorFormUnavailable,
  );
  const seen = useRef(initial.sent);
  useEffect(() => {
    if (answer.sent && seen.current !== answer.sent) {
      seen.current = answer.sent;
      onSent(answer.sent);
    }
  }, [answer.sent, onSent]);
  const noticeId = `${id}-notice`;
  useFocusAfterAnswer(answer, answer.notice ? noticeId : id, !pending);
  return (
    <form
      action={post}
      className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
    >
      <input type="hidden" name="requestId" value={answer.requestId} />
      <CountedTextarea
        key={answer.text}
        id={id}
        name="text"
        aria-label="Message debaters and host"
        defaultValue={answer.text}
        required
        rows={2}
        maxUnits={maxUnits}
        disabled={pending}
        readOnly={locked || answer.uncertain === true}
        describedBy={answer.notice ? noticeId : undefined}
        placeholder="Message debaters and host"
        className="min-w-0 resize-none rounded-sm border border-border-strong bg-background px-3 py-2 text-sm disabled:opacity-60"
        onKeyDown={(event) => {
          if (
            locked ||
            pending ||
            event.key !== 'Enter' ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          )
            return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      {answer.notice ? (
        <p
          id={noticeId}
          role="status"
          tabIndex={-1}
          className="text-sm text-ink-muted"
        >
          {answer.notice}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || locked}
        aria-label={answer.uncertain ? 'Retry message' : 'Send message'}
        className="inline-flex h-room-target cursor-pointer items-center justify-center gap-2 self-end rounded-sm bg-accent px-3 text-sm font-strong text-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="send" size={16} />
        {pending ? 'Sending…' : answer.uncertain ? 'Retry message' : 'Send'}
      </button>
    </form>
  );
}
