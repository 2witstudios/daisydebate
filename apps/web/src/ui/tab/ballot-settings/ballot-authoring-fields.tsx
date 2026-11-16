'use client';
import { useId, useState } from 'react';
import { FormField } from '../../components/form-field/form-field';
export const authoringControlClass =
  'min-h-10 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-ink';
export function NumberField({
  name,
  label,
  value,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: number | undefined;
}) {
  const id = useId();
  return (
    <FormField id={id} label={label}>
      <input
        id={id}
        name={name}
        type="number"
        step="any"
        required
        defaultValue={value ?? ''}
        className={authoringControlClass}
      />
    </FormField>
  );
}
export function TextField({
  name,
  label,
  value = '',
  multiline = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly value?: string | undefined;
  readonly multiline?: boolean;
}) {
  const id = useId();
  return (
    <FormField id={id} label={label}>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          required
          defaultValue={value}
          className={authoringControlClass}
          rows={3}
        />
      ) : (
        <input
          id={id}
          name={name}
          required
          defaultValue={value}
          className={authoringControlClass}
        />
      )}
    </FormField>
  );
}
export function Toggle({
  name,
  label,
  value,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: boolean;
}) {
  return (
    <label className="flex min-h-10 items-center gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={value}
        className="size-5 accent-accent"
      />
      {label}
    </label>
  );
}
export function WrittenFields({
  kind,
  value,
}: {
  readonly kind: 'reason' | 'feedback';
  readonly value:
    { readonly required: boolean; readonly max: number } | null | undefined;
}) {
  const [rule, setRule] = useState(
    value === undefined
      ? ''
      : value === null
        ? 'off'
        : value.required
          ? 'required'
          : 'optional',
  );
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-4 max-narrow:grid-cols-1">
      <FormField
        id={id}
        label={kind === 'reason' ? 'Reason for decision' : 'Feedback'}
      >
        <select
          id={id}
          name={`${kind}-rule`}
          required
          value={rule}
          onChange={(event) => setRule(event.target.value)}
          className={authoringControlClass}
        >
          <option value="" disabled>
            Choose collection
          </option>
          <option value="required">Required</option>
          <option value="optional">Optional</option>
          <option value="off">Off</option>
        </select>
      </FormField>
      {rule !== 'off' && rule !== '' ? (
        <NumberField
          name={`${kind}-max`}
          label="Character limit"
          value={value?.max}
        />
      ) : null}
    </div>
  );
}
