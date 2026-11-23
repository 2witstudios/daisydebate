'use client';

import { useNavigation } from '../edge/use-navigation';
import { navigateDocument } from '../edge/browser-navigation';
import { StatusRegion } from '../components/status-region/status-region';
import { useId, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../form-action/form-action';
import { FormError } from '../components/form-field/form-field';
import {
  clubFields,
  clubFormUnavailable,
  initialClubForm,
  type ClubFormState,
} from './club-form-state';

/** What the form's fields render from: the values typed, and whether the answer is pending. */
export type ClubFormRender = {
  readonly values: Readonly<Record<string, string>>;
  readonly pending: boolean;
  readonly done: boolean;
};

/**
 * One club form posting to its server action. A refusal renders beside the
 * fields with the typed values kept; a lost answer says so. A destination
 * off this origin (Stripe Checkout) is loaded as a document.
 */
export function ClubForm({
  action,
  label,
  className,
  children,
  focusTarget,
  onlyWhenLost = false,
}: {
  readonly action: FormAction<ClubFormState>;
  readonly label: string;
  readonly className?: string;
  readonly children: (render: ClubFormRender) => ReactNode;
  /** The element focus returns to after an answer. */
  readonly focusTarget?: string;
  readonly onlyWhenLost?: boolean;
}) {
  const [answered, post, posting] = useFormAction(
    action,
    initialClubForm,
    clubFormUnavailable,
  );
  const router = useRouter();
  const errorId = useId();
  const next = answered.kind === 'moved' ? answered.next : undefined;
  useNavigation(router, next, (navigator, destination) => {
    if (
      /^https?:\/\//.test(destination) &&
      new URL(destination).origin !== location.origin
    )
      navigateDocument(destination);
    else navigator.replace(destination);
  });
  const pending = posting || answered.kind === 'moved';
  useFocusAfterAnswer(answered, focusTarget, !posting, { onlyWhenLost });
  const fields = clubFields(answered);
  return (
    <form
      action={post}
      aria-label={label}
      aria-busy={pending}
      aria-describedby={fields.error ? errorId : undefined}
      className={className}
    >
      {children({
        values: fields.values,
        pending,
        done: answered.kind === 'done',
      })}
      <div id={errorId}>
        <FormError error={fields.error} />
        {answered.kind === 'unacknowledged' ? (
          <StatusRegion as="p" role="alert" className="text-sm text-live">
            We could not tell whether that went through. Check the page, then
            try again.
          </StatusRegion>
        ) : null}
      </div>
    </form>
  );
}
