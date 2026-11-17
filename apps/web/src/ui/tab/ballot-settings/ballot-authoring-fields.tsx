'use client';
import { useId, useState } from 'react';
import { FormField } from '../../components/form-field/form-field';
import { usePostedValues } from '../../form-action/posted-values';
export const authoringControlClass =
  'min-h-10 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-ink';
/**
 * A field of fixed name seeds from the value just posted under that name;
 * a row's field (whose name follows its position) passes `fromPost={false}`
 * and its row's own seed instead, so removing a row never shifts values.
 */
export function NumberField({
  name,
  label,
  value,
  fromPost = true,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: number | string | undefined;
  readonly fromPost?: boolean;
}) {
  const id = useId();
  const postedValues = usePostedValues();
  const posted = fromPost ? postedValues : null;
  return (
    <FormField id={id} label={label}>
      <input
        id={id}
        name={name}
        type="number"
        step="any"
        required
        defaultValue={posted?.[name] ?? value ?? ''}
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
  fromPost = true,
}: {
  readonly name: string;
  readonly label: string;
  readonly value?: string | undefined;
  readonly multiline?: boolean;
  /** As for NumberField. */
  readonly fromPost?: boolean;
}) {
  const id = useId();
  const posted = usePostedValues();
  const seed = (fromPost ? posted?.[name] : undefined) ?? value;
  return (
    <FormField id={id} label={label}>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          required
          defaultValue={seed}
          className={authoringControlClass}
          rows={3}
        />
      ) : (
        <input
          id={id}
          name={name}
          required
          defaultValue={seed}
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
  posted: wasPosted = true,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: boolean;
  /** Whether the box was on the form when it was posted. */
  readonly posted?: boolean;
}) {
  // A posted form sends a checkbox only when it is ticked, and never one it
  // did not show, which keeps its own default.
  const postedValues = usePostedValues();
  const posted = wasPosted ? postedValues : null;
  return (
    <label className="flex min-h-10 items-center gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={posted ? posted[name] === 'on' : value}
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
  const posted = usePostedValues()?.[`${kind}-rule`];
  const [rule, setRule] = useState(
    posted !== undefined
      ? posted
      : value === undefined
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
