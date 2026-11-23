'use client';

import { Announcement } from '../../components/announcement/announcement';
import type { ReactNode } from 'react';
import type { GuardianFormState } from '../../../features/parental-controls/form';
import {
  formUnavailable,
  initialFormState,
} from '../../../features/forms/form-state';
import { useFormAction } from '../../form-action/form-action';
import { Button } from '../../components/button/button';

export type GuardianFormAction = (
  state: GuardianFormState,
  data: FormData,
) => Promise<GuardianFormState>;

export function GuardianForm({
  action,
  label,
  children,
  secondary = false,
}: {
  readonly action: GuardianFormAction;
  readonly label: string;
  readonly children?: ReactNode;
  readonly secondary?: boolean;
}) {
  const [state, post, pending] = useFormAction(
    action,
    initialFormState,
    formUnavailable,
  );
  return (
    <form action={post} className="flex flex-col gap-3" aria-busy={pending}>
      <fieldset
        disabled={pending}
        className="flex flex-col items-start gap-3 border-0 p-0"
      >
        {children}
        <Button type="submit" variant={secondary ? 'secondary' : 'primary'}>
          {pending ? 'Saving…' : label}
        </Button>
      </fieldset>
      {state.kind === 'refused' ? (
        <Announcement as="p" kind="problem" className="text-sm text-live">
          {state.error}
        </Announcement>
      ) : null}
      {state.kind === 'sent' ? (
        <Announcement as="p" kind="progress" className="text-sm text-ink">
          {state.message}
        </Announcement>
      ) : null}
    </form>
  );
}
