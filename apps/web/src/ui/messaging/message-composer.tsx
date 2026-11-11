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
import { Icon } from '../components/icon/icon';
import { destinationOf } from '../../features/forms/form-state';
import {
  messageFields,
  messageFormUnavailable,
  messageIdle,
  type MessageFormState,
} from '../../features/messaging/forms/send-form';

type ComposerProps = {
  readonly action: FormAction<MessageFormState>;
  readonly channelId: string;
  readonly maxUnits: number;
  /** The last message the reader saw; a native send marks it read (ISSUE-606). */
  readonly readThrough?: number | null;
  /** The field's empty line: who this goes to. */
  readonly placeholder?: string;
};

/**
 * Form identity follows the committed-command lifecycle, never the request ID
 * itself: React adopts a no-JavaScript POST's answer only into the same key path,
 * and every server render issues a new ID.
 */
export function MessageComposer(props: ComposerProps) {
  const { requestId, generation, restoreFocus } = useConversationCommand();
  return (
    <MessageComposerForm
      {...props}
      key={generation}
      requestId={requestId}
      restoreFocus={restoreFocus}
    />
  );
}

function MessageComposerForm({
  action,
  requestId,
  channelId,
  maxUnits,
  readThrough,
  placeholder,
  restoreFocus,
}: ComposerProps & {
  readonly requestId: string;
  readonly restoreFocus: boolean;
}) {
  const dispatch = useConversationAction(action);
  const [answer, post, pending] = useFormAction(
    dispatch,
    messageIdle(requestId),
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
  const fields = messageFields(answer);
  const moving = destinationOf(answer) !== undefined;
  useFocusAfterAnswer(
    answer,
    fields.notice ? 'message-notice' : 'message-text',
    !pending,
  );
  return (
    <form
      action={post}
      className="flex shrink-0 flex-col gap-1 px-6 pb-4 max-narrow:px-4"
    >
      <input type="hidden" name="requestId" value={fields.requestId} />
      {readThrough == null ? null : (
        <input type="hidden" name="readThrough" value={readThrough} />
      )}
      <div className="flex flex-wrap items-end gap-1 rounded-md border border-border bg-surface-raised p-1 focus-within:border-border-strong hover:border-border-strong">
        <label htmlFor="message-text" className="sr-only">
          Your message
        </label>
        <CountedTextarea
          key={fields.text}
          id="message-text"
          name="text"
          defaultValue={fields.text}
          maxUnits={maxUnits}
          required
          autoFocus={restoreFocus}
          disabled={pending || moving}
          rows={1}
          placeholder={placeholder}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a new line, and Enter confirming an
            // input method's composition belongs to that composition.
            if (
              event.key !== 'Enter' ||
              event.shiftKey ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          onInput={(event) => {
            void typing.current?.activity(event.currentTarget.value.length > 0);
          }}
          onBlur={() => {
            void typing.current?.activity(false);
          }}
          className="field-sizing-content max-h-composer-max min-w-0 flex-1 resize-none bg-transparent px-2 py-2 leading-normal text-ink placeholder:text-ink-muted disabled:opacity-60"
          describedBy={fields.notice ? 'message-notice' : undefined}
          countClassName="order-last basis-full px-2 pb-1"
        />
        <button
          type="submit"
          disabled={pending || moving}
          aria-label={pending ? 'Sending…' : 'Send message'}
          title="Send message"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-sm bg-accent text-accent-ink hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="send" />
        </button>
      </div>
      <DraftNotice id="message-notice" notice={fields.notice} />
    </form>
  );
}
