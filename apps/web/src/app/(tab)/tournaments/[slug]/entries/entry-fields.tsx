'use client';

import { useRef } from 'react';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../../../../ui/components/form-field/form-field-class';
import {
  useFormResets,
  usePostedValues,
} from '../../../../../ui/form-action/posted-values';

export function EntryFields({
  divisions,
}: {
  readonly divisions: readonly {
    readonly key: string;
    readonly label: string;
  }[];
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const resets = useFormResets(anchor);
  const posted = usePostedValues();
  return (
    <div ref={anchor} className="flex flex-col gap-4">
      <label className={fieldClass}>
        <span className={labelClass}>Entry name</span>
        <input
          key={resets}
          name="name"
          defaultValue={posted?.name}
          className={controlClass}
          required
          maxLength={120}
        />
      </label>
      {divisions.length ? (
        <label className={fieldClass}>
          <span className={labelClass}>Division</span>
          <select
            key={resets}
            name="division"
            defaultValue={posted?.division ?? ''}
            className={controlClass}
          >
            <option value="">No division</option>
            {divisions.map((division) => (
              <option key={division.key} value={division.key}>
                {division.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="division" value="" />
      )}
    </div>
  );
}
