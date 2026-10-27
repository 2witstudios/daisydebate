import { isNamedSeat, type RoomView } from '@daisy/protocol';
import Link from 'next/link';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { ROOM_SETUP_HREF, roomMeta, roomStatus } from './room-labels';
import { RoomInvite } from './room-invite';
import { drawnTopicLabel } from '../../../features/debate-room/vocabulary';
import { ROOM_SETUP_HOME, ROOM_TITLE } from './room-setup-modal';

/** The resolution, labelled as such: the statement the two sides debate. */
export function RoomResolution({
  view,
}: {
  readonly view: Pick<RoomView, 'topic' | 'capabilities'>;
}) {
  return (
    <section
      aria-labelledby="room-resolution-title"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised px-6 py-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id="room-resolution-title"
          className="text-xs font-bold tracking-wide text-ink-muted uppercase"
        >
          Resolution
        </h2>
        <span className="text-sm text-ink-muted">
          The statement the two sides debate
        </span>
        {view.capabilities.canEdit ? (
          <a
            href={ROOM_SETUP_HREF}
            className="ml-auto inline-flex min-h-room-target items-center text-sm font-strong"
          >
            Edit
          </a>
        ) : null}
      </div>
      {view.topic === null ? (
        <p className="font-display text-2xl leading-tight text-ink-muted">
          {drawnTopicLabel}
        </p>
      ) : (
        <p className="font-display text-2xl leading-tight font-semibold wrap-anywhere">
          {view.topic}
        </p>
      )}
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span>
          <span className="font-strong text-hue-sky">Affirmative</span>{' '}
          <span className="text-ink-muted">argues for it</span>
        </span>
        <span>
          <span className="font-strong text-hue-clay">Negative</span>{' '}
          <span className="text-ink-muted">argues against it</span>
        </span>
      </p>
    </section>
  );
}

/** The host closes the room for everyone, behind a native confirm. */
function CloseRoom({
  view,
  commandId,
  action,
}: {
  readonly view: Pick<RoomView, 'version'>;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
}) {
  return (
    <details className="relative">
      <summary className={`${buttonClass('secondary')} list-none`}>
        Close room
      </summary>
      <div className="absolute top-full right-0 z-30 mt-2 flex w-room-dialog max-w-full flex-col gap-3 rounded-lg border border-border-strong bg-surface p-4 shadow-3">
        <p className="text-sm">
          Close this room for everyone? Nobody can join or start a round in it
          again.
        </p>
        <AssemblyCommandForm action={action}>
          <AssemblyCommandFields
            type="close"
            version={view.version}
            commandId={commandId}
          />
          <button type="submit" className={buttonClass('primary')}>
            Close room for everyone
          </button>
        </AssemblyCommandForm>
      </div>
    </details>
  );
}

/**
 * The room's name is the page title; its status and meta read as one line
 * each. A room number (ISSUE-582) prefixes the name once rooms carry one.
 */
export function AssemblyHeader({
  view,
  actorId,
  roomNumber,
  commandIds,
  commandAction,
}: {
  readonly view: RoomView;
  readonly actorId: string;
  readonly roomNumber?: number;
  readonly commandIds: { readonly leave: string; readonly close: string };
  readonly commandAction: FormAction<RoomFormState>;
}) {
  const seated = view.participants
    .filter(isNamedSeat)
    .some((seat) => seat.actorId === actorId);
  return (
    <header className="flex flex-col gap-3">
      <Link
        href="/lobby"
        className="inline-flex min-h-12 items-center self-start text-sm text-ink-muted"
      >
        ‹ Lobby
      </Link>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-strong text-hue-teal">
            {roomStatus(view)}
          </p>
          <h1
            {...{ [ROOM_TITLE]: '' }}
            tabIndex={-1}
            className="font-display text-3xl leading-tight font-semibold tracking-tight wrap-anywhere"
          >
            {roomNumber === undefined ? null : (
              <span className="text-ink-muted">Room {roomNumber} · </span>
            )}
            {view.title}
          </h1>
          <p className="text-sm text-ink-muted">{roomMeta(view).join(' · ')}</p>
          {view.capabilities.host && !seated ? (
            <p className="text-sm font-strong">
              You’re hosting · not in a seat
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <RoomInvite
            roomId={view.id}
            visibility={view.visibility}
            label="Copy invite link"
          />
          {view.capabilities.canEdit ? (
            <a
              href={ROOM_SETUP_HREF}
              {...{ [ROOM_SETUP_HOME]: '' }}
              className={buttonClass('secondary')}
            >
              Room setup
            </a>
          ) : null}
          {view.capabilities.host &&
          (view.status === 'assembling' || view.status === 'ready') ? (
            <CloseRoom
              view={view}
              commandId={commandIds.close}
              action={commandAction}
            />
          ) : null}
          {seated ? (
            <AssemblyCommandForm action={commandAction}>
              <AssemblyCommandFields
                type="leave-seat"
                version={view.version}
                commandId={commandIds.leave}
              />
              <button type="submit" className={buttonClass('secondary')}>
                Leave seat
              </button>
            </AssemblyCommandForm>
          ) : null}
        </div>
      </div>
    </header>
  );
}
