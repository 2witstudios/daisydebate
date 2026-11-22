'use client';

import { StatusRegion } from '../../components/status-region/status-region';
import { Button } from '../../components/button/button';
import {
  ReleasePaidAdsFields,
  ReleaseSignatureFields,
} from '../../media-releases/parent/release-signature-fields';
import {
  destinationOf,
  formFields,
  initialFormState,
  unacknowledged,
  type FormState,
  type Unacknowledged,
} from '../../../features/forms/form-state';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';

type Action = FormAction<FormState | Unacknowledged>;

export function LinkedGuardianReleaseForm({
  minor,
  action,
}: {
  readonly minor: string;
  readonly action: Action;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialFormState,
    unacknowledged,
  );
  if (state.kind === 'done')
    return (
      <StatusRegion as="p" role="status">
        Media release signed. A copy and a withdrawal link will be sent to your
        account email.
      </StatusRegion>
    );
  const { error, values } = formFields(state);
  return (
    <form
      action={submit}
      className="flex max-w-release-column flex-col gap-5"
      aria-busy={pending}
    >
      <ReleasePaidAdsFields minor={minor} values={values} />
      <ReleaseSignatureFields minor={minor} values={values} />
      {error ? (
        <StatusRegion as="p" role="alert" className="text-sm text-live">
          {error}
        </StatusRegion>
      ) : null}
      {state.kind === 'unacknowledged' ? (
        <StatusRegion as="p" role="alert">
          We couldn’t confirm the signature. Reload to check whether it was
          saved.
        </StatusRegion>
      ) : null}
      <Button type="submit" className="self-start" aria-disabled={pending}>
        Sign release
      </Button>
    </form>
  );
}

export function CloseChildAccountForm({ action }: { readonly action: Action }) {
  const [state, submit, pending] = useFormAction(
    action,
    initialFormState,
    unacknowledged,
  );
  useMovedOn(destinationOf(state));
  const { error, values } = formFields(state);
  return (
    <form
      action={submit}
      className="flex flex-col items-start gap-3"
      aria-busy={pending}
    >
      <label className="flex items-start gap-2 text-sm">
        <input
          name="confirm"
          type="checkbox"
          required
          defaultChecked={values['confirm'] === 'on'}
          className="mt-1 accent-accent"
        />
        I withdraw my consent and confirm that Daisy should close this account.
      </label>
      {error ? (
        <StatusRegion as="p" role="alert" className="text-sm text-live">
          {error}
        </StatusRegion>
      ) : null}
      {state.kind === 'unacknowledged' ? (
        <StatusRegion as="p" role="alert">
          We couldn’t confirm closure. Return to Parental controls to check the
          account.
        </StatusRegion>
      ) : null}
      <Button type="submit" variant="secondary" aria-disabled={pending}>
        Withdraw consent and close account
      </Button>
    </form>
  );
}
