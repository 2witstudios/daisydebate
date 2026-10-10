'use client';
import { useEffect, useRef } from 'react';
import { createBrowserTypingWriter } from './typing-browser';
import { DraftNotice } from './draft-notice';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import {
  messageFormUnavailable,
  type MessageFormState,
} from '../../features/messaging/forms/send-form';

export function MessageComposer({
  action,
  requestId,
  channelId,
  maxUnits,
}: {
  readonly action: FormAction<MessageFormState>;
  readonly requestId: string;
  readonly channelId: string;
  readonly maxUnits: number;
}) {
  const [answer, post, pending] = useFormAction<MessageFormState>(
    action,
    { text: '', requestId },
    messageFormUnavailable,
  );
  const typing = useRef<ReturnType<typeof createBrowserTypingWriter> | null>(
    null,
  );
  useEffect(() => {
    const writer = createBrowserTypingWriter(channelId);
    typing.current = writer;
    return () => {
      typing.current = null;
      void writer.close();
    };
  }, [channelId]);
  useEffect(() => {
    if (pending) void typing.current?.activity(false);
  }, [pending]);
  useMovedOn(answer.next);
  useFocusAfterAnswer(
    answer,
    answer.notice ? 'message-notice' : 'message-text',
    !pending,
  );
  return (
    <form
      action={post}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4"
    >
      <input type="hidden" name="requestId" value={answer.requestId} />
      <label htmlFor="message-text" className="text-sm font-semibold">
        Your message
      </label>
      <textarea
        key={answer.text}
        id="message-text"
        name="text"
        defaultValue={answer.text}
        maxLength={maxUnits}
        required
        disabled={pending}
        rows={4}
        onInput={(event) => {
          void typing.current?.activity(event.currentTarget.value.length > 0);
        }}
        onBlur={() => {
          void typing.current?.activity(false);
        }}
        className="rounded-md border border-border-strong bg-surface px-3 py-2 text-ink disabled:opacity-60"
        aria-describedby={answer.notice ? 'message-notice' : undefined}
      />
      <DraftNotice id="message-notice" notice={answer.notice} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || answer.next !== undefined}>
          {pending ? 'Sending…' : 'Send message'}
        </Button>
      </div>
    </form>
  );
}
