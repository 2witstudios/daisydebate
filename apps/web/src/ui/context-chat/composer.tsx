'use client';

import { Announcement } from '../components/announcement/announcement';
import { Button } from '../components/button/button';
import { useRef } from 'react';
import { contextChatFormUnavailable } from '../../features/messaging/context-chat/form';
import {
  contextChatAcceptedMessage,
  contextChatFields,
  type ContextChatFormState,
} from '../../features/messaging/context-chat/form-state';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { CountedTextarea } from '../messaging/counted-textarea';
import { Icon } from '../components/icon/icon';

/** Command identity survives refusals and unknown results; a confirmed answer alone rotates it. */
export function ContextChatComposer({
  id,
  label,
  initial,
  action,
  maxUnits,
  onSent,
  locked = false,
}: {
  readonly id: string;
  /** Whom the message goes to: the field's accessible name and placeholder. */
  readonly label: string;
  readonly initial: ContextChatFormState;
  readonly action: FormAction<ContextChatFormState>;
  readonly maxUnits: number;
  readonly locked?: boolean;
  readonly onSent: (messageId: string) => void;
}) {
  const seen = useRef(contextChatAcceptedMessage(initial));
  const [answer, post, pending] = useFormAction(
    action,
    initial,
    contextChatFormUnavailable,
    (answered) => {
      const sent = contextChatAcceptedMessage(answered);
      if (sent !== undefined && seen.current !== sent) {
        seen.current = sent;
        onSent(sent);
      }
    },
  );
  const fields = contextChatFields(answer);
  const noticeId = `${id}-notice`;
  useFocusAfterAnswer(answer, fields.notice ? noticeId : id, !pending);
  return (
    <form
      action={post}
      className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
    >
      <input type="hidden" name="requestId" value={fields.requestId} />
      <CountedTextarea
        key={fields.text}
        id={id}
        name="text"
        aria-label={label}
        defaultValue={fields.text}
        required
        rows={2}
        maxUnits={maxUnits}
        disabled={pending}
        readOnly={locked || fields.retrying}
        describedBy={fields.notice ? noticeId : undefined}
        placeholder={label}
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
      {fields.notice ? (
        <Announcement
          as="p"
          id={noticeId}
          kind="progress"
          tabIndex={-1}
          className="text-sm text-ink-muted"
        >
          {fields.notice}
        </Announcement>
      ) : null}
      <Button
        variant="compact"
        type="submit"
        disabled={pending || locked}
        aria-label={fields.retrying ? 'Retry message' : 'Send message'}
        className="h-room-target gap-2 self-end rounded-sm bg-accent px-3 font-strong text-accent-ink disabled:opacity-60"
      >
        <Icon name="send" size={16} />
        {pending ? 'Sending…' : fields.retrying ? 'Retry message' : 'Send'}
      </Button>
    </form>
  );
}
