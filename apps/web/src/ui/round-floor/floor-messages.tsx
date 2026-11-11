'use client';
import { useState } from 'react';
import type { FloorMessage } from '../../features/messaging/round-floor/history';
import type { FloorFormState } from '../../features/messaging/round-floor/form-state';
import { floorMessageRows, type FloorAvailableMessage } from './message-rows';
import { FloorMessageControls } from './message-controls';

/** The same keyed row keeps an opened own editor mounted when protected history is withdrawn. */
export function FloorMessages(props: {
  readonly channelId: string;
  readonly actorId: string;
  readonly roundId: string;
  readonly messages: readonly FloorMessage[];
  readonly authors: readonly {
    readonly actorId: string;
    readonly label: string;
  }[];
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly maxUnits: number;
  readonly mutateAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
  readonly reportAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
  readonly refresh: (id: string) => void;
}) {
  const [held, setHeld] = useState<readonly FloorAvailableMessage[]>([]);
  const rows = floorMessageRows({
    actorId: props.actorId,
    channelId: props.channelId,
    messages: props.hidden ? [] : props.messages,
    held,
  });
  const keep = (message: FloorAvailableMessage) => {
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
  return (
    <ol
      aria-label="Floor messages"
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
                        )?.label ?? 'Member')}
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
                <FloorMessageControls
                  messageId={row.id}
                  returnFocusId={`floor-message-${props.roundId}`}
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
