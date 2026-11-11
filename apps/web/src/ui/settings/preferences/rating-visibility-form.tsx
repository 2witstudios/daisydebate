'use client';

import type { RatingVisibility } from '@daisy/protocol';
import {
  initialSaveForm,
  saveNotice,
  saveRefused,
  type SaveFormState,
} from '../../../features/forms/save-form';
import { Button } from '../../components/button/button';
import { useFormAction, type FormAction } from '../../form-action/form-action';

/**
 * Which ratings your card shows when people look at you (ADR 0103). Freestyle
 * always shows. A native form, and your ladders stay public either way.
 */
export function RatingVisibilityForm({
  action,
  visibility,
}: {
  readonly action: FormAction<SaveFormState>;
  readonly visibility: Pick<RatingVisibility, 'showPolicy' | 'showValue'>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialSaveForm,
    saveRefused,
  );
  const notice = saveNotice(answer);
  return (
    <form action={post} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-base text-ink">
        <input type="checkbox" checked disabled /> Freestyle
      </label>
      <label className="flex items-center gap-2 text-base text-ink">
        <input
          type="checkbox"
          name="showPolicy"
          defaultChecked={visibility.showPolicy}
        />{' '}
        Policy
      </label>
      <label className="flex items-center gap-2 text-base text-ink">
        <input
          type="checkbox"
          name="showValue"
          defaultChecked={visibility.showValue}
        />{' '}
        Value
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
        {notice ? (
          <p role="status" className="text-sm text-ink-muted">
            {notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}
