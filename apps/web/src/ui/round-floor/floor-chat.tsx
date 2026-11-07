'use client';
import { idSchema } from '@daisy/protocol';
import { FloorComposer } from './composer';
import { FloorMessageControls } from './message-controls';
import { useFloorChat, type FloorChatProps } from './use-floor-chat';
export type { FloorChatProps } from './use-floor-chat';
const buttonClass =
  'min-h-room-target cursor-pointer rounded-sm border border-border px-3 text-sm font-strong disabled:opacity-60';
export function FloorChat({
  active = true,
  onUnread,
  ...props
}: FloorChatProps & {
  readonly active?: boolean;
  readonly onUnread?: ((count: number) => void) | undefined;
}) {
  const {
    state,
    page,
    before,
    paging,
    notice,
    channelId,
    live,
    hidden,
    history,
    renderedMessages,
    expired,
    locked,
    initial,
    pending,
    enter,
    loadHistory,
    refresh,
  } = useFloorChat({ ...props, active, onUnread });
  return (
    <section
      aria-label="Round floor chat"
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="font-strong">Debaters and host</h2>
        <p className="text-xs text-ink-muted">The host can read this chat.</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {pending ? <p role="status">Loading Round chat…</p> : null}
        {state.kind === 'empty' || (history && !history.messages.length) ? (
          <p role="status">No messages.</p>
        ) : null}
        {state.kind === 'denied' || live.status === 'hidden' || expired ? (
          <p role="status">This Round chat is unavailable.</p>
        ) : null}
        {state.kind === 'unavailable' || notice ? (
          <p role="status">{notice ?? 'Round chat could not be loaded.'}</p>
        ) : null}
        {state.kind === 'unavailable' ||
        state.kind === 'denied' ||
        live.status === 'hidden' ||
        notice ? (
          <button
            type="button"
            onClick={() => void enter()}
            className={buttonClass}
          >
            Try again
          </button>
        ) : null}
        {!hidden && !expired && before !== null ? (
          <button
            type="button"
            disabled={paging}
            className={buttonClass}
            onClick={() => channelId && void loadHistory(channelId, before)}
          >
            {paging ? 'Loading…' : 'Older messages'}
          </button>
        ) : null}
        {
          <ol
            aria-label="Floor messages"
            className="flex flex-col gap-3"
            hidden={hidden || expired}
          >
            {[...renderedMessages].reverse().map((message) => (
              <li
                key={message.id}
                className="rounded-sm bg-surface-raised p-3 text-sm"
              >
                {'unavailable' in message ? (
                  <p className="text-ink-muted">Message removed.</p>
                ) : (
                  <>
                    {!hidden && !expired ? (
                      <>
                        <p className="font-strong">
                          {message.authorActorId === props.actorId
                            ? 'You'
                            : (page?.authors.find(
                                (author) =>
                                  author.actorId === message.authorActorId,
                              )?.label ?? 'Member')}
                        </p>
                        <p className="wrap-anywhere whitespace-pre-wrap">
                          {message.text}
                        </p>
                        {message.editedAt ? (
                          <span className="text-xs text-ink-muted">Edited</span>
                        ) : null}
                      </>
                    ) : null}
                    <FloorMessageControls
                      messageId={message.id}
                      text={message.text}
                      own={message.authorActorId === props.actorId}
                      locked={hidden || expired}
                      editingLocked={locked}
                      maxUnits={page?.bounds.messageUnits ?? 4000}
                      mutateAction={props.mutateAction.bind(
                        null,
                        message.channelId,
                      )}
                      reportAction={props.reportAction.bind(
                        null,
                        message.channelId,
                      )}
                      onSent={refresh}
                    />
                  </>
                )}
              </li>
            ))}
          </ol>
        }
      </div>
      {props.readOnlyHint ||
      (state.kind === 'ready' && state.metadata.readOnly) ? (
        <p role="status" className="px-3 text-sm text-ink-muted">
          This Round chat is read-only.
        </p>
      ) : null}
      {channelId && idSchema.safeParse(channelId).success ? (
        <FloorComposer
          id={`floor-message-${props.roundId}`}
          initial={initial}
          action={props.sendAction.bind(null, channelId)}
          maxUnits={page?.bounds.messageUnits ?? 4000}
          locked={locked}
          onSent={refresh}
        />
      ) : null}
    </section>
  );
}
