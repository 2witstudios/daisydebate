'use client';

import { useRef } from 'react';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';

/** The host closes the room for everyone, behind a confirm dialog. */
export function CloseRoom({
  version,
  commandId,
  action,
}: {
  readonly version: number;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className={buttonClass('secondary')}
      >
        Close room
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="close-room-title"
        className="m-auto w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 backdrop:bg-scrim/50 open:flex"
      >
        <h2 id="close-room-title" className="font-display text-lg">
          Close this room for everyone?
        </h2>
        <p className="text-sm text-ink-muted">
          Nobody can join or start a round in it again.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className={buttonClass('secondary')}
          >
            Cancel
          </button>
          <AssemblyCommandForm action={action}>
            <AssemblyCommandFields
              type="close"
              version={version}
              commandId={commandId}
            />
            <button type="submit" className={buttonClass('primary')}>
              Close room for everyone
            </button>
          </AssemblyCommandForm>
        </div>
      </dialog>
    </>
  );
}
