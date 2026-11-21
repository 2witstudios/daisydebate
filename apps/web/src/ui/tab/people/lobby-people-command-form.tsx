'use client';
import { useId } from 'react';
import {
  useFormAction,
  useFocusAfterAnswer,
} from '../../form-action/form-action';
import {
  initialLobbyPeopleCommand,
  lobbyPeopleCommandFields,
  lobbyPeopleCommandUnacknowledged,
  lobbyPeopleCommandValues,
  type LobbyPeopleCommandState,
} from '../../../features/tab/lobby-people-forms';
import type { PeopleCommandModel } from '../../../features/tab/people-command-model';
import { PeopleCommandFields } from './people-command-fields';
export function LobbyPeopleCommandForm({
  model,
  action,
}: {
  readonly model: Extract<
    PeopleCommandModel,
    { kind: 'give-lobby' | 'remove' }
  >;
  readonly action: (
    previous: LobbyPeopleCommandState,
    form: FormData,
  ) => Promise<LobbyPeopleCommandState>;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialLobbyPeopleCommand(),
    (form) => lobbyPeopleCommandUnacknowledged(lobbyPeopleCommandValues(form)),
  );
  const noticeId = useId();
  const fields = lobbyPeopleCommandFields(state);
  useFocusAfterAnswer(
    state,
    fields.error ? noticeId : 'tab-people-title',
    !pending,
    { onlyWhenLost: true },
  );
  return (
    <PeopleCommandFields
      model={model}
      fields={fields}
      noticeId={noticeId}
      submit={submit}
      pending={pending}
    />
  );
}
