import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '../../cn';

export const field =
  'h-10 w-full rounded-md border border-border bg-surface-raised px-3 text-base text-ink disabled:opacity-60';
export const labelClass = 'text-base font-strong text-ink';
export const hint = 'text-sm text-ink-faint';
export const card = 'flex flex-col gap-5 rounded-xl bg-surface p-6 shadow-1';

export function Field({
  id,
  label,
  note,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {note ? <span className={hint}>{note}</span> : null}
    </div>
  );
}

export function Segmented({
  label,
  options,
}: {
  readonly label: string;
  readonly options: readonly {
    readonly key: string;
    readonly text: string;
    readonly href: string;
    readonly on: boolean;
  }[];
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => (
          <li key={option.key}>
            <Link
              href={option.href}
              aria-current={option.on ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-10 items-center rounded-sm border px-4 text-base font-strong no-underline hover:no-underline',
                option.on
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-border-strong text-ink',
              )}
            >
              {option.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
