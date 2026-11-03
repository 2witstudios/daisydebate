'use client';
import { Button } from '../../components/button/button';
import {
  ActionForm,
  type FormStateAction,
} from '../../form-action/action-form';

/** A native post that marks one notification, or all of them, as read. */
export function MarkReadButton({
  action,
  label,
}: {
  readonly action: FormStateAction;
  readonly label: string;
}) {
  return (
    <ActionForm action={action} label={label}>
      {({ pending }) => (
        <Button type="submit" variant="secondary" disabled={pending}>
          {label}
        </Button>
      )}
    </ActionForm>
  );
}
