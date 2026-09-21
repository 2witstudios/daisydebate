import type { ReactNode } from 'react';

export type EmailFieldProps = {
  readonly id: string;
  readonly label: string;
  /** The submit control that sits beside the input. */
  readonly action: ReactNode;
  /** `username webauthn` lets the browser offer a saved passkey. */
  readonly autoComplete: 'username webauthn' | 'email';
  /** Controlled value; omit for a plain server-posted form. */
  readonly value?: string;
  readonly typeEmail?: (email: string) => void;
  readonly disabled?: boolean;
  /** Id of the notice that explains why the address was refused. */
  readonly errorId?: string;
};

/** Email input with its label and submit control on one row. */
export function EmailField({
  id,
  label,
  action,
  autoComplete,
  value,
  typeEmail,
  disabled = false,
  errorId,
}: EmailFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="flex gap-3 max-narrow:flex-col">
        <input
          id={id}
          name="email"
          type="email"
          required
          autoComplete={autoComplete}
          placeholder="you@school.edu"
          value={value}
          onChange={
            typeEmail && ((event) => typeEmail(event.currentTarget.value))
          }
          disabled={disabled}
          aria-invalid={errorId === undefined ? undefined : true}
          aria-describedby={errorId}
          className="h-auth-control min-w-0 grow rounded-md border border-border-strong bg-surface-raised px-4 text-md text-ink placeholder:text-ink-faint disabled:opacity-60 aria-invalid:border-live"
        />
        {action}
      </div>
    </div>
  );
}
