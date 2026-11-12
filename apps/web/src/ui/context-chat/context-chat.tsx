'use client';
import { idSchema } from '@daisy/protocol';
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
  const readOnly =
    props.readOnlyHint || (state.kind === 'ready' && state.metadata.readOnly);
  const composed = !readOnly || labels.readOnly.composer === 'locked';
  return (
    <section
      aria-label={labels.region}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="font-strong">{labels.heading}</h2>
        <p className="text-xs text-ink-muted">{labels.audience}</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {pending ? <p role="status">{`Loading ${context.name}…`}</p> : null}
        {state.kind === 'empty' || (history && !history.messages.length) ? (
          <p role="status">No messages.</p>
        ) : null}
        {state.kind === 'denied' || live.status === 'hidden' || expired ? (
          <p role="status">{`This ${context.name} is unavailable.`}</p>
        ) : null}
        {state.kind === 'unavailable' || notice ? (
          <p role="status">
            {notice ?? `${context.name} could not be loaded.`}
          </p>
        ) : null}
        {state.kind === 'unavailable' ||
        state.kind === 'denied' ||
        live.status === 'hidden' ||
        notice ? (
          <button type="button" onClick={enter} className={buttonClass}>
            Try again
          </button>
        ) : null}
        {!hidden && !expired && before !== null ? (
          <button
            type="button"
            disabled={paging}
            className={buttonClass}
            onClick={() => loadOlder(before)}
          >
            {paging ? 'Loading…' : 'Older messages'}
          </button>
        ) : null}
        {channelId ? (
          <ContextChatMessages
            key={channelId}
            channelId={channelId}
            actorId={props.actorId}
            label={labels.messages}
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
        <p
          role="status"
          className="px-3 text-sm text-ink-muted"
          // With no composer, a message control returns focus here instead.
          {...(composed ? {} : { id: composerId, tabIndex: -1 })}
        >
          {labels.readOnly.notice}
        </p>
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
