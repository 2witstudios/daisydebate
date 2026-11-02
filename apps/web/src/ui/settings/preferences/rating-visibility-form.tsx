'use client';

import type { RatingVisibility } from '@daisy/protocol';
import { Button } from '../../components/button/button';
import { useFormAction, type FormAction } from '../../form-action/form-action';

export type RatingVisibilityState = { readonly notice?: string };

const unavailable = (): RatingVisibilityState => ({
  notice: 'Could not save. Try again.',
});

/**
 * Which ratings your card shows when people look at you (ADR 0103). Freestyle
 * always shows. A native form, and your ladders stay public either way.
 */
export function RatingVisibilityForm({
  action,
  visibility,
}: {
  readonly action: FormAction<RatingVisibilityState>;
  readonly visibility: Pick<RatingVisibility, 'showPolicy' | 'showValue'>;
}) {
  const [answer, post, pending] = useFormAction(action, {}, unavailable);
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
        {answer.notice ? (
          <p role="status" className="text-sm text-ink-muted">
            {answer.notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}
