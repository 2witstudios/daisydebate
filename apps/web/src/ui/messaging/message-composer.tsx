'use client';
import { useEffect, useRef } from 'react';
import { createBrowserTypingWriter } from './typing-browser';
import { DraftNotice } from './draft-notice';
import { CountedTextarea } from './counted-textarea';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import {
  useConversationAction,
  useConversationCommand,
  useConversationCompletion,
} from './conversation-navigation';
import { Button } from '../components/button/button';
import {
  messageFormUnavailable,
  type MessageFormState,
} from '../../features/messaging/forms/send-form';

type ComposerProps = {
  readonly action: FormAction<MessageFormState>;
  readonly channelId: string;
  readonly maxUnits: number;
  /** The last message the reader saw; a native send marks it read (ISSUE-606). */
  readonly readThrough?: number | null;
};

/** Form identity follows the conversation's committed-command lifecycle. */
export function MessageComposer(props: ComposerProps) {
  const requestId = useConversationCommand();
  return (
    <MessageComposerForm {...props} key={requestId} requestId={requestId} />
  );
}

function MessageComposerForm({
  action,
  requestId,
  channelId,
  maxUnits,
  readThrough,
}: ComposerProps & { readonly requestId: string }) {
  const dispatch = useConversationAction(action, requestId);
  const [answer, post, pending] = useFormAction(
    dispatch,
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
  useConversationCompletion(answer, pending);
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
      {readThrough == null ? null : (
        <input type="hidden" name="readThrough" value={readThrough} />
      )}
      <label htmlFor="message-text" className="text-sm font-semibold">
        Your message
      </label>
      <CountedTextarea
        key={answer.text}
        id="message-text"
        name="text"
        defaultValue={answer.text}
        maxUnits={maxUnits}
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
        describedBy={answer.notice ? 'message-notice' : undefined}
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
