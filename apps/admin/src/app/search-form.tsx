import type { FormHTMLAttributes } from 'react';

/**
 * A form that only changes a page's query, submitted by GET to `action`. It
 * is the operator app's one module that renders a GET form (ADR 0114,
 * scripts/javascript-required.ts).
 */
export function SearchForm({
  action,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, 'action' | 'method'> & {
  /** The page whose query the form sets. */
  readonly action: string;
}) {
  return <form {...props} action={action} method="get" />;
}
