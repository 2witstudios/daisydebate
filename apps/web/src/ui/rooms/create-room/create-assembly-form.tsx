'use client';

import type { RatingDivision } from '@daisy/protocol';
import { useState, useTransition } from 'react';
import {
  destinationOf,
  idle,
  type FormFields,
} from '../../../features/forms/form-state';
import type { RoomTemplate } from '../../../features/rooms/read-catalog';
import {
  postRoomDraft,
  roomDraftFields,
  type RoomDraftAnswer,
} from '../../../features/rooms/create-room-answer';
import { defaultChoice } from '../../../features/rooms/format-browser';
import { FormError } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';
import { useFocusAfterAnswer } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { CreateRoomEditor } from './create-room-editor';

type FieldsProps = {
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
  readonly state: FormFields;
  readonly pending: boolean;
  readonly initialRanked?: boolean;
  /** The member's ladder division (ADR 0147); null with no age on record, so no ranked play. */
  readonly memberDivision: RatingDivision | null;
};

export function CreateAssemblyFields({
  commandId,
  choices,
  state,
  pending,
  initialRanked = false,
  memberDivision,
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
      initialChoice={first}
      values={state.values}
      commandId={commandId}
      initialRanked={initialRanked && memberDivision !== null}
      memberDivision={memberDivision}
      pending={pending}
      error={state.error}
    />
  );
}

const unanswered: RoomDraftAnswer = idle();

/** Local draft editing enhances the same native, authenticated creation action. */
export function CreateAssemblyForm({
  initialState = unanswered,
  sourceRoomId,
  commandId,
  choices,
  initialRanked = false,
  memberDivision,
}: {
  readonly initialState?: RoomDraftAnswer;
  readonly sourceRoomId?: string;
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
  readonly initialRanked?: boolean;
  /** The member's ladder division (ADR 0147); null with no age on record, so no ranked play. */
  readonly memberDivision: RatingDivision | null;
}) {
  const [state, setState] = useState<RoomDraftAnswer>(initialState);
  const [pending, startTransition] = useTransition();
  const fields = roomDraftFields(state);
  useMovedOn(destinationOf(state));
  useFocusAfterAnswer(
    state,
    fields.error ? 'create-room-answer' : 'create-settings-title',
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
        key={JSON.stringify(fields.values)}
        commandId={commandId}
        choices={choices}
        state={fields}
        pending={pending}
        initialRanked={initialRanked}
        memberDivision={memberDivision}
      />
    </form>
  );
}
