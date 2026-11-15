import { buttonClass } from '../../components/button/button-class';
import { errorClass } from '../../components/form-field/form-field-class';
import { Button } from '../../components/button/button';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import type { peopleCommandFields } from '../../../features/tab/organization-people-forms';
import type { PeopleCommandModel } from './people-command-form';

const options = (
  items: readonly { readonly value: string; readonly label: string }[],
) =>
  items.map((item) => (
    <option key={item.value} value={item.value}>
      {item.label}
    </option>
  ));
/** Controls within the existing people screen; no action is represented by a sample link. */
export function PeopleCommandFields({
  model,
  fields,
  submit,
  pending,
  noticeId,
}: {
  readonly model: PeopleCommandModel;
  readonly fields: ReturnType<typeof peopleCommandFields>;
  readonly submit: (form: FormData) => void;
  readonly pending: boolean;
  readonly noticeId: string;
}) {
  const label =
    model.kind === 'give' ? 'Give someone a role' : `Change ${model.person}`;
  return (
    <details className="flex flex-col items-start gap-3">
      <summary
        className={
          model.kind === 'give'
            ? buttonClass('primary')
            : 'cursor-pointer font-strong text-ink underline'
        }
      >
        {model.kind === 'give' ? 'Give someone a role' : 'Change'}
      </summary>
      <form
        action={submit}
        aria-label={label}
        className="flex max-w-dash-column flex-col gap-3 rounded-md border border-border bg-surface-raised p-4"
      >
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
          <legend className="sr-only">{label}</legend>
          {model.kind === 'give' ? (
            <>
              <label className={fieldClass}>
                <span className={labelClass}>Member</span>
                <select
                  name="userId"
                  defaultValue={fields.values.userId}
                  required
                  className={controlClass}
                >
                  <option value="" disabled>
                    Choose a member
                  </option>
                  {options(model.members)}
                </select>
              </label>
              <label className={fieldClass}>
                <span className={labelClass}>Preset role</span>
                <select
                  name="roleId"
                  defaultValue={fields.values.roleId}
                  required
                  className={controlClass}
                >
                  <option value="" disabled>
                    Choose a role
                  </option>
                  {options(model.roles)}
                </select>
              </label>
              <label className={fieldClass}>
                <span className={labelClass}>Applies to</span>
                <select
                  name="scope"
                  defaultValue={fields.values.scope}
                  required
                  className={controlClass}
                >
                  {options(model.scopes)}
                </select>
              </label>
              <label className={fieldClass}>
                <span className={labelClass}>Expiry (UTC, optional)</span>
                <input
                  name="expiresAt"
                  type="datetime-local"
                  step={60}
                  defaultValue={fields.values.expiresAt}
                  className={controlClass}
                />
              </label>
            </>
          ) : (
            <label className={fieldClass}>
              <span className={labelClass}>Role to end</span>
              <select
                name="grantId"
                required
                defaultValue={fields.values.grantId}
                className={controlClass}
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {options(model.grants)}
              </select>
            </label>
          )}
          <Button type="submit" disabled={pending}>
            {pending
              ? 'Saving…'
              : model.kind === 'give'
                ? 'Give role'
                : 'End role'}
          </Button>
        </fieldset>
        {!pending && (fields.error || fields.notice) ? (
          <p
            id={noticeId}
            tabIndex={-1}
            role={fields.error ? 'alert' : 'status'}
            className={fields.error ? errorClass : 'text-sm text-ink-muted'}
          >
            {fields.error ?? fields.notice}
          </p>
        ) : null}
      </form>
    </details>
  );
}
