'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  ActionForm,
  type FormStateAction,
} from '../../form-action/action-form';
import { ANSWERED } from './answered';

/** Builds the action a sample form posts to, from the label of its submit. */
export type SampleSubmit = (label: string) => FormStateAction;

/**
 * A Tab form a server component can render: a real POST to a server action,
 * so nothing typed can leak into the address before hydration. Most have no
 * operation behind them yet, and their action saves nothing and answers with
 * the sample banner; the walk form's action keeps the chosen scene.
 *
 * A sample answer moves on to the page the form is on, so the form is made
 * again for each answer: one left mounted would stay busy after its first.
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
  const answered = useSearchParams()?.get(ANSWERED) ?? '';
  return (
    <ActionForm
      key={answered}
      action={action}
      label={label}
      {...(className === undefined ? {} : { className })}
    >
      {() => children}
    </ActionForm>
  );
}
