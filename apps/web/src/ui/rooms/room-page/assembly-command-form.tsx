'use client';

import type { ReactNode } from 'react';
import type { MockFormState } from '../../../features/mock-form/form';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { commandUnavailable } from '../../../features/rooms/command-answer';
import { useMovedOn } from '../../form-action/use-moved-on';
import { FormError } from '../../components/form-field/form-field';

function CommandNavigation({ next }: { readonly next: string }) {
  useMovedOn(next);
  return null;
}
/** Native POST keeps the server action; hydrated transport failures preserve a retryable form. */
export function AssemblyCommandForm({
  action,
  children,
  className,
}: {
  readonly action: FormAction<MockFormState>;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const [state, post, pending] = useFormAction(
    action,
    { values: {} },
    commandUnavailable,
  );
  return (
    <form action={post} className={className}>
      {state.next ? <CommandNavigation next={state.next} /> : null}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      <FormError error={state.error} />
    </form>
  );
}
