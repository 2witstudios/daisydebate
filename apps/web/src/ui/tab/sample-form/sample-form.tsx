'use client';

import type { ReactNode } from 'react';
import {
  ActionForm,
  type FormStateAction,
} from '../../form-action/action-form';

/** Builds the action a sample form posts to, from the label of its submit. */
export type SampleSubmit = (label: string) => FormStateAction;

/**
 * A form with no operation behind it yet. It is still a real POST to a
 * server action, so nothing typed can leak into the address before
 * hydration; the action saves nothing and answers with the sample banner.
 */
export function SampleForm({
  action,
  label,
  className,
  children,
}: {
  readonly action: FormStateAction;
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <ActionForm
      action={action}
      label={label}
      {...(className === undefined ? {} : { className })}
    >
      {() => children}
    </ActionForm>
  );
}
