import type { ReactNode } from 'react';
import {
  errorClass,
  fieldClass,
  helperClass,
  labelClass,
} from './form-field-class';

/** A labelled control with an optional helper line. */
export function FormField({
  id,
  label,
  helper,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly helper?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={fieldClass}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {helper ? (
        <p id={`${id}-helper`} className={helperClass}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}

/** The refusal under a form: shown as an alert, absent when there is none. */
export function FormError({ error }: { readonly error: string | undefined }) {
  return error === undefined ? null : (
    <p role="alert" className={errorClass}>
      {error}
    </p>
  );
}
