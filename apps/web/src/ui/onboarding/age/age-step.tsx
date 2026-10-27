'use client';

import {
  initialAgeForm,
  monthNames,
  type AgeFormState,
} from '../../../features/account/age-form';
import { useFormAction } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import {
  AuthFrame,
  AuthHeading,
  taglinePanel,
} from '../../auth/auth-frame/auth-frame';

/** The age form's server action, bound to the validated destination. */
export type AgeAction = (
  state: AgeFormState,
  form: FormData,
) => Promise<AgeFormState>;

const unavailable = (): AgeFormState => ({
  ...initialAgeForm,
  unavailable: true,
});

const selectClass =
  'h-auth-control min-w-0 flex-1 max-narrow:flex-none rounded-md border border-border-strong bg-surface-raised px-4 text-md text-ink aria-invalid:border-live disabled:opacity-60';

const missingCopy = {
  month: 'Choose your birth month.',
  year: 'Choose your birth year.',
  terms: 'Agree to the Terms and Privacy notice to continue.',
} as const;

/**
 * The age step (WAIT-4.6): the birth month and year, with no default and no
 * mention of any age the answer is held to, and the Terms and Privacy
 * acceptance. A real POST to a server action, so it works before hydration
 * and without JavaScript; the server bands the answer and decides.
 */
export function AgeStep({
  action,
  years,
}: {
  readonly action: AgeAction;
  readonly years: readonly number[];
}) {
  const [answered, post, posting] = useFormAction(
    action,
    initialAgeForm,
    unavailable,
  );
  useMovedOn(answered.next);
  const pending = posting || answered.next !== undefined;
  const missing = new Set(answered.missing);
  const errors = answered.missing.map((name) => missingCopy[name]);
  return (
    <AuthFrame panel={taglinePanel} footer="Next: choose your username.">
      <AuthHeading eyebrow="Before you start" title="When were you born?">
        Month and year only. Daisy keeps it private.
      </AuthHeading>
      <form action={post} className="flex flex-col gap-4" aria-busy={pending}>
        <fieldset
          className="flex flex-col gap-2 border-0 p-0"
          disabled={pending}
        >
          <legend className="mb-2 text-sm font-semibold">
            Birth month and year
          </legend>
          <div className="flex gap-3 max-narrow:flex-col">
            <select
              name="month"
              aria-label="Month"
              required
              defaultValue={answered.month}
              aria-invalid={missing.has('month') ? true : undefined}
              className={selectClass}
            >
              <option value="">Month</option>
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select
              name="year"
              aria-label="Year"
              required
              defaultValue={answered.year}
              aria-invalid={missing.has('year') ? true : undefined}
              className={selectClass}
            >
              <option value="">Year</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <label className="flex min-h-auth-control items-start gap-3 text-md">
          <input
            type="checkbox"
            name="terms"
            value="accepted"
            required
            defaultChecked={answered.terms}
            disabled={pending}
            aria-invalid={missing.has('terms') ? true : undefined}
            className="mt-1 size-5 shrink-0 accent-accent"
          />
          <span>
            I agree to the{' '}
            <a href="/terms" className="font-semibold">
              Terms
            </a>{' '}
            and the{' '}
            <a href="/privacy" className="font-semibold">
              Privacy notice
            </a>
            .
          </span>
        </label>
        <div role="alert" className="flex flex-col gap-1 empty:hidden">
          {errors.map((error) => (
            <p key={error} className="text-sm font-semibold text-live">
              {error}
            </p>
          ))}
          {answered.unavailable ? (
            <p className="text-sm font-semibold text-live">
              That didn’t save. Try again.
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          disabled={pending}
          className="h-auth-control self-start"
        >
          {pending ? 'Saving…' : 'Continue'}
          <Icon name="arrowRight" size={18} />
        </Button>
      </form>
    </AuthFrame>
  );
}
