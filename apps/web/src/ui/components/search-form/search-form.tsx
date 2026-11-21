import type { FormHTMLAttributes } from 'react';

/**
 * A form that only changes a page's query: a search or a filter, submitted
 * by GET to `action` (ADR 0114).
 */
export function SearchForm({
  action,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, 'action' | 'method'> & {
  /** The page whose query the form sets. */
  readonly action: string;
}) {
  return <form role="search" {...props} action={action} method="get" />;
}
