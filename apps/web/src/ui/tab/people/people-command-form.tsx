'use client';
import { useId } from 'react';
import {
  useFormAction,
  useFocusAfterAnswer,
} from '../../form-action/form-action';
import {
  initialPeopleCommand,
  peopleCommandFields,
  peopleCommandUnacknowledged,
  peopleCommandValues,
  type PeopleCommandState,
} from '../../../features/tab/organization-people-forms';
import { PeopleCommandFields } from './people-command-fields';

import type { PeopleCommandModel } from './people-command-model';
export type PeopleCommandAction = (
  previous: PeopleCommandState,
  form: FormData,
) => Promise<PeopleCommandState>;
/** The binding owns only action state; command parsing and decisions live at the operation boundary. */
export function PeopleCommandForm({
  model,
  action,
}: {
  readonly model: Exclude<PeopleCommandModel, { kind: 'give-lobby' }>;
  readonly action: PeopleCommandAction;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialPeopleCommand(),
    (form) => peopleCommandUnacknowledged(peopleCommandValues(form)),
  );
  const noticeId = useId();
  const fields = peopleCommandFields(state);
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
