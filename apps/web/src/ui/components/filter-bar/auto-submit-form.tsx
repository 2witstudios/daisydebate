'use client';

import type { ComponentProps } from 'react';
import { SearchForm } from '../search-form/search-form';
import { submitOnChange } from './submit-on-change';

/** A filter form that also applies a select or radio change at once. */
export function AutoSubmitForm(props: ComponentProps<typeof SearchForm>) {
  return (
    <SearchForm
      {...props}
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
