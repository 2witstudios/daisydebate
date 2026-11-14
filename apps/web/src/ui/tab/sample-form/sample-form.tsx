'use client';

import type { ReactNode } from 'react';
import {
  ActionForm,
  type FormStateAction,
} from '../../form-action/action-form';

/** Builds the action a sample form posts to, from the label of its submit. */
export type SampleSubmit = (label: string) => FormStateAction;

/**
 * A Tab form a server component can render: a real POST to a server action,
 * so nothing typed can leak into the address before hydration. Most have no
 * operation behind them yet, and their action saves nothing and answers with
 * the sample banner; the walk form's action keeps the chosen scene.
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
