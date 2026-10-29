'use client';

import { useState, useTransition } from 'react';
import type { FormState } from '../../../features/forms/form-state';
import type { PublishedResolution } from '@daisy/protocol';
import type { RoomTemplate } from '../../../features/rooms/read-catalog';
import {
  postRoomDraft,
  type RoomDraftAnswer,
} from '../../../features/rooms/create-room-answer';
import { defaultChoice } from '../../../features/rooms/format-browser';
import { FormError } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';
import { useFocusAfterAnswer } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { CreateRoomEditor } from './create-room-editor';

type CreateState = {
  readonly values: Readonly<Record<string, string>>;
  readonly error?: string;
  readonly next?: string;
};

type FieldsProps = {
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
  readonly resolutions?: readonly PublishedResolution[];
  readonly state: CreateState;
  readonly pending: boolean;
  readonly initialRated?: boolean;
};

export function CreateAssemblyFields({
  commandId,
  choices,
  resolutions = [],
  state,
  pending,
  initialRated = false,
}: FieldsProps) {
  const first = defaultChoice(choices);
  if (!first)
    return (
      <div className="create-room-card create-room-section">
        <label className="create-room-field">
          <span>Room name</span>
          <input
            name="title"
            className={controlClass}
            defaultValue={state.values.title ?? ''}
          />
        </label>
        <FormError error={state.error} />
        <p role="status">No formats are available yet.</p>
        <button type="submit" disabled className={buttonClass('primary')}>
          Create room
        </button>
      </div>
    );
  return (
    <CreateRoomEditor
      choices={choices}
      resolutions={resolutions}
      initialChoice={first}
      values={state.values}
      commandId={commandId}
      initialRated={initialRated}
      pending={pending}
      error={state.error}
    />
  );
}

/** Local draft editing enhances the same native, authenticated creation action. */
export function CreateAssemblyForm({
  initialState = { values: {} },
  sourceRoomId,
  commandId,
  choices,
  resolutions = [],
  initialRated = false,
}: {
  readonly initialState?: FormState;
  readonly sourceRoomId?: string;
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
  readonly resolutions?: readonly PublishedResolution[];
  readonly initialRated?: boolean;
}) {
  const [state, setState] = useState<RoomDraftAnswer>(initialState);
  const [pending, startTransition] = useTransition();
  useMovedOn(state.next);
  useFocusAfterAnswer(
    state,
    state.error ? 'create-room-answer' : 'create-settings-title',
    !pending,
  );
  return (
    <form
      action="/play/room/submit"
      method="post"
      encType="multipart/form-data"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(
          event.currentTarget,
          (event.nativeEvent as SubmitEvent).submitter,
        );
        startTransition(async () => {
          setState(await postRoomDraft(fetch, form));
        });
      }}
      aria-label="Create a room"
      className="create-room-form"
      onInvalidCapture={(event) => {
        const element = event.target as HTMLElement;
        element.closest('details')?.setAttribute('open', '');
      }}
    >
      {sourceRoomId ? (
        <input type="hidden" name="sourceRoomId" value={sourceRoomId} />
      ) : null}
      <CreateAssemblyFields
        key={JSON.stringify(state.values)}
        commandId={commandId}
        choices={choices}
        resolutions={state.resolutions ?? resolutions}
        state={state}
        pending={pending}
        initialRated={initialRated}
      />
    </form>
  );
}
