'use client';
import { Announcement } from '../components/announcement/announcement';
import { Button } from '../components/button/button';
import { idSchema } from '@daisy/protocol/primitives';
import type { ChatContext } from '../../features/messaging/context-chat/chat-context';
import type { ContextChatLabels } from './chat-labels';
import { ContextChatComposer } from './composer';
import { ContextChatMessages } from './chat-messages';
import { useContextChat, type ContextChatProps } from './use-context-chat';
export type { ContextChatProps } from './use-context-chat';
const buttonClass =
  'min-h-room-target cursor-pointer rounded-sm border border-border px-3 text-sm font-strong disabled:opacity-60';
type ThreadProps = ContextChatProps & {
  readonly context: ChatContext;
  readonly labels: ContextChatLabels;
  readonly active?: boolean;
  readonly onUnread?: ((count: number) => void) | undefined;
  /** What the page may say about an author beside their name, such as a seat. */
  readonly authorLabel?: ((actorId: string) => string | null) | undefined;
};
/** One context's embedded thread: its history, live messages, controls and composer. */
export function ContextChat(props: ThreadProps) {
  return (
    <BoundContextChat
      key={`${props.ownerId}:${props.actorId}:${props.socketUrl ?? ''}`}
      {...props}
    />
  );
}
function BoundContextChat({
  context,
  labels,
  active = true,
  onUnread,
  authorLabel,
  ...props
}: ThreadProps) {
  const {
    state,
    authors,
    messageUnits,
    before,
    paging,
    notice,
    channelId,
    live,
    hidden,
    history,
    messages,
    expired,
    locked,
    initial,
    pending,
    enter,
    loadOlder,
    refresh,
  } = useContextChat({ ...props, context, active, onUnread });
  const composerId = `${labels.idPrefix}-message-${props.ownerId}`;
  // The page's hint until the chat is found; its own metadata after.
  const readOnly =
    state.kind === 'ready' ? state.metadata.readOnly : props.readOnlyHint;
  const composed = !readOnly || labels.readOnly.composer === 'locked';
  return (
    <section
      aria-label={labels.region}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="font-strong">{labels.heading}</h2>
        {labels.audience ? (
          <p className="text-xs text-ink-muted">{labels.audience}</p>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {pending ? (
          <Announcement
            as="p"
            kind="progress"
          >{`Loading ${context.name}…`}</Announcement>
        ) : null}
        {state.kind === 'empty' || (history && !history.messages.length) ? (
          <Announcement as="p" kind="progress">
            No messages.
          </Announcement>
        ) : null}
        {state.kind === 'denied' || live.status === 'hidden' || expired ? (
          <Announcement
            as="p"
            kind="progress"
          >{`This ${context.name} is unavailable.`}</Announcement>
        ) : null}
        {state.kind === 'unavailable' || notice ? (
          <Announcement as="p" kind="progress">
            {notice ?? `${context.name} could not be loaded.`}
          </Announcement>
        ) : null}
        {state.kind === 'unavailable' ||
        state.kind === 'denied' ||
        live.status === 'hidden' ||
        notice ? (
          <Button
            variant="unstyled"
            type="button"
            onClick={enter}
            className={buttonClass}
          >
            Try again
          </Button>
        ) : null}
        {!hidden && !expired && before !== null ? (
          <Button
            variant="unstyled"
            type="button"
            disabled={paging}
            className={buttonClass}
            onClick={() => loadOlder(before)}
          >
            {paging ? 'Loading…' : 'Older messages'}
          </Button>
        ) : null}
        {channelId ? (
          <ContextChatMessages
            key={channelId}
            channelId={channelId}
            actorId={props.actorId}
            label={labels.messages}
            unnamedAuthor={labels.unnamedAuthor}
            idPrefix={labels.idPrefix}
            returnFocusId={composerId}
            messages={messages}
            authors={authors}
            authorLabel={authorLabel}
            hidden={hidden || expired}
            locked={locked}
            maxUnits={messageUnits}
            mutateAction={props.mutateAction}
            reportAction={props.reportAction}
            refresh={refresh}
          />
        ) : null}
      </div>
      {readOnly ? (
        <Announcement
          as="p"
          kind="progress"
          className="px-3 text-sm text-ink-muted"
          // With no composer, a message control returns focus here instead.
          {...(composed ? {} : { id: composerId, tabIndex: -1 })}
        >
          {labels.readOnly.notice}
        </Announcement>
      ) : null}
      {composed && channelId && idSchema.safeParse(channelId).success ? (
        <ContextChatComposer
          id={composerId}
          label={labels.composer}
          initial={initial}
          action={props.sendAction.bind(null, channelId)}
          maxUnits={messageUnits}
          locked={locked}
          onSent={refresh}
        />
      ) : null}
    </section>
  );
}
