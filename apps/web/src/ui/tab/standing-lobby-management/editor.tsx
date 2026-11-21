'use client';
import { useId } from 'react';
import { lobbyAgeRules } from '@daisy/protocol/lobby/eligibility';
import { linkTo } from '../../../features/tab/action';
import {
  destinationOf,
  formFields,
  idle,
  unacknowledged,
  type FormValues,
} from '../../../features/forms/form-state';
import type { StandingLobbyFormState } from '../../../features/tab/standing-lobby-form';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading } from '../list-card/list-card';
import { Button } from '../../components/button/button';
import { controlClass } from '../../components/form-field/form-field-class';
import { FormField } from '../../components/form-field/form-field';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { ageRuleLabel } from './labels';

type Editor =
  | { readonly kind: 'lobby' }
  | { readonly kind: 'ladder'; readonly lobbyName: string }
  | { readonly kind: 'open-season'; readonly today: string }
  | { readonly kind: 'edit-season' }
  | {
      readonly kind: 'close-season';
      readonly lobbyName: string;
      readonly seasonName: string;
    };

function Fields({
  editor,
  values,
}: {
  readonly editor: Editor;
  readonly values: FormValues;
}) {
  const id = useId();
  if (editor.kind === 'close-season')
    return (
      <p>
        Ranked play in {editor.lobbyName} pauses until another season opens.{' '}
        {editor.seasonName} standings stay available.
      </p>
    );
  return (
    <>
      <FormField id={`${id}-name`} label="Name">
        <input
          id={`${id}-name`}
          className={controlClass}
          name="name"
          defaultValue={values.name}
          required
          maxLength={120}
        />
      </FormField>
      {editor.kind === 'lobby' ? (
        <FormField
          id={`${id}-age`}
          label="Who can debate"
          helper="This rule applies to debaters. The lobby’s tournaments inherit it."
        >
          <select
            id={`${id}-age`}
            name="ageRule"
            className={controlClass}
            defaultValue={values.ageRule ?? 'anyone'}
            aria-describedby={`${id}-age-helper`}
          >
            {lobbyAgeRules.map((rule) => (
              <option key={rule} value={rule}>
                {ageRuleLabel[rule]}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
      {editor.kind === 'ladder' ? (
        <p className="text-sm text-ink-muted">
          Ratings on this ladder belong to {editor.lobbyName}.
        </p>
      ) : null}
      {editor.kind === 'open-season' ? (
        <FormField id={`${id}-starts`} label="Starts on">
          <input
            id={`${id}-starts`}
            name="starts"
            type="date"
            max={editor.today}
            className={controlClass}
            defaultValue={values.starts ?? editor.today}
            required
          />
        </FormField>
      ) : null}
      {editor.kind === 'open-season' || editor.kind === 'edit-season' ? (
        <FormField id={`${id}-ends`} label="Ends on (optional)">
          <input
            id={`${id}-ends`}
            name="ends"
            type="date"
            className={controlClass}
            defaultValue={values.ends}
          />
        </FormField>
      ) : null}
      {editor.kind === 'open-season' ? (
        <p className="text-sm text-ink-muted">
          Only one season can be active in this lobby. This does not change
          seasons in other lobbies.
        </p>
      ) : null}
    </>
  );
}

const headings = {
  lobby: 'Lobby details',
  ladder: 'Ladder details',
  'open-season': 'Season details',
  'edit-season': 'Season details',
  'close-season': 'Confirm closure',
} as const;

export function StandingLobbyEditor({
  action,
  cancel,
  editor,
  initialValues,
  submitLabel,
}: {
  readonly action: FormAction<StandingLobbyFormState>;
  readonly cancel: string;
  readonly editor: Editor;
  readonly initialValues: FormValues;
  readonly submitLabel: string;
}) {
  const [state, submit, pending] = useFormAction<StandingLobbyFormState>(
    action,
    idle(initialValues),
    unacknowledged,
  );
  const fields = formFields(state);
  const next = destinationOf(state);
  const retry = state.kind === 'unacknowledged';
  const notice = useId();
  useMovedOn(next);
  useFocusAfterAnswer(
    state,
    fields.error || retry ? notice : undefined,
    !pending,
  );
  return (
    <ListCard>
      <ListHeading>{headings[editor.kind]}</ListHeading>
      <form
        action={submit}
        aria-busy={pending}
        className="flex flex-col gap-4 p-4"
      >
        <fieldset
          disabled={pending || retry || next !== undefined}
          className="flex flex-col gap-4"
        >
          <Fields editor={editor} values={fields.values} />
        </fieldset>
        {retry
          ? Object.entries(fields.values).map(([name, value]) => (
              <input key={name} name={name} value={value} type="hidden" />
            ))
          : null}
        {fields.error || retry ? (
          <p
            id={notice}
            role="status"
            tabIndex={-1}
            className="text-sm text-ink"
          >
            {retry
              ? 'The answer was lost. Retry the same change, or reload to check what was saved.'
              : fields.error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending || next !== undefined}>
            {retry ? 'Retry save' : submitLabel}
          </Button>
          <ActionButton action={linkTo('Cancel', cancel)} />
        </div>
      </form>
    </ListCard>
  );
}
