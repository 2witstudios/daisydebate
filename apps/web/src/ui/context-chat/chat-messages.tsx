'use client';
import { useState } from 'react';
import type { ContextChatMessage } from '../../features/messaging/context-chat/history';
import type { ContextChatFormState } from '../../features/messaging/context-chat/form-state';
import {
  contextChatMessageRows,
  type ContextChatAvailableMessage,
} from './message-rows';
import { ContextChatMessageControls } from './message-controls';

/** The same keyed row keeps an opened own editor mounted when protected history is withdrawn. */
export function ContextChatMessages(props: {
  readonly channelId: string;
  readonly actorId: string;
  /** The accessible name of the list. */
  readonly label: string;
  /** What stands for an author this reader is given no name for. */
  readonly unnamedAuthor: string;
  readonly idPrefix: string;
  /** Where focus goes when a message's own controls go away. */
  readonly returnFocusId: string;
  /** What the page may say about an author beside their name. */
  readonly authorLabel?: ((actorId: string) => string | null) | undefined;
  readonly messages: readonly ContextChatMessage[];
  readonly authors: readonly {
    readonly actorId: string;
    readonly label: string;
  }[];
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly maxUnits: number;
  readonly mutateAction: (
    channelId: string,
    previous: ContextChatFormState,
    form: FormData,
  ) => Promise<ContextChatFormState>;
  readonly reportAction: (
    channelId: string,
    previous: ContextChatFormState,
    form: FormData,
  ) => Promise<ContextChatFormState>;
  readonly refresh: (id: string) => void;
}) {
  const [held, setHeld] = useState<readonly ContextChatAvailableMessage[]>([]);
  const rows = contextChatMessageRows({
    actorId: props.actorId,
    channelId: props.channelId,
    messages: props.hidden ? [] : props.messages,
    held,
  });
  const keep = (message: ContextChatAvailableMessage) => {
    if (
      message.authorActorId !== props.actorId ||
      message.channelId !== props.channelId
    )
      return;
    setHeld((previous) => [
      ...previous.filter((item) => item.id !== message.id),
      message,
    ]);
  };
  const release = (id: string) =>
    setHeld((previous) => previous.filter((message) => message.id !== id));
  const seatOf = (actorId: string) => props.authorLabel?.(actorId) ?? null;
  return (
    <ol
      aria-label={props.label}
      className="flex flex-col gap-3"
      hidden={props.hidden}
    >
      {rows.map((row) => {
        const available =
          row.body && !('unavailable' in row.body) ? row.body : null;
        const writable = !props.hidden && available !== null;
        return (
          <li
            key={row.id}
            hidden={!row.body || props.hidden}
            className="rounded-sm bg-surface-raised p-3 text-sm"
          >
            {row.body ? (
              'unavailable' in row.body ? (
                <p className="text-ink-muted">Message removed.</p>
              ) : (
                <>
                  <p className="font-strong">
                    {row.body.authorActorId === props.actorId
                      ? 'You'
                      : (props.authors.find(
                          (author) =>
                            author.actorId === available?.authorActorId,
                        )?.label ?? props.unnamedAuthor)}
                    {seatOf(row.body.authorActorId) ? (
                      <span className="font-book text-ink-muted">
                        {' · '}
                        {seatOf(row.body.authorActorId)}
                      </span>
                    ) : null}
                  </p>
                  <p className="wrap-anywhere whitespace-pre-wrap">
                    {row.body.text}
                  </p>
                  {row.body.editedAt ? (
                    <span className="text-xs text-ink-muted">Edited</span>
                  ) : null}
                </>
              )
            ) : null}
            <div hidden={!writable}>
              {row.control ? (
                <ContextChatMessageControls
                  messageId={row.id}
                  idPrefix={props.idPrefix}
                  returnFocusId={props.returnFocusId}
                  changeVersion={row.control.changeVersion}
                  text={row.control.text}
                  own={row.control.authorActorId === props.actorId}
                  locked={!writable}
                  editingLocked={props.locked}
                  maxUnits={props.maxUnits}
                  mutateAction={props.mutateAction.bind(null, props.channelId)}
                  reportAction={props.reportAction.bind(null, props.channelId)}
                  onSent={props.refresh}
                  keepDraft={() => row.control && keep(row.control)}
                  releaseDraft={() => release(row.id)}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
