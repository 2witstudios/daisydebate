'use client';

import type { FormHTMLAttributes } from 'react';
import { submitOnChange } from './submit-on-change';

/**
 * A GET form that also applies a select or radio change at once. The form
 * itself works with no script; this only removes a click once hydrated.
 */
export function AutoSubmitForm(props: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      {...props}
      method="get"
      onChange={({ target }) => {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement
        )
          submitOnChange(target);
      }}
    />
  );
}
