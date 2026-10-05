import Link from 'next/link';
import type { ReactNode } from 'react';

/** The numbered steps; the last step (your first debate) shows no count. */
export const onboardingSteps = 6;

const touch =
  'inline-flex min-h-onboarding-touch items-center justify-center rounded-round px-6 text-md font-strong no-underline hover:no-underline';
const primary = `${touch} bg-accent text-accent-ink hover:bg-accent-strong`;

export type OnboardingFrameProps = {
  /** 1-based step number, or null on the last step. */
  readonly step: number | null;
  /** The id of the step's heading, which names the dialog. */
  readonly titleId: string;
  /** The Skip form; absent on the last step. */
  readonly skip?: ReactNode;
  readonly children: ReactNode;
};

/**
 * One onboarding step as a card on the bare layout: progress and Skip
 * above, the step below. Plain markup, so every step renders and works
 * before hydration and without JavaScript.
 */
export function OnboardingFrame({
  step,
  titleId,
  skip,
  children,
}: OnboardingFrameProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-ink max-narrow:p-0">
      <section
        role="dialog"
        aria-labelledby={titleId}
        className="flex min-h-onboarding-card w-full max-w-onboarding flex-col gap-6 rounded-xl border border-border bg-surface-raised px-12 pt-6 pb-10 shadow-3 max-narrow:min-h-dvh max-narrow:rounded-none max-narrow:border-0 max-narrow:px-5 max-narrow:pt-4 max-narrow:pb-6"
      >
        <div className="flex min-h-onboarding-touch flex-wrap items-center justify-between gap-4">
          {step === null ? (
            <span className="font-display text-xl font-semibold text-ink">
              Daisy
            </span>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex gap-2" aria-hidden="true">
                {Array.from({ length: onboardingSteps }, (_, index) => (
                  <span
                    key={index}
                    data-segment={index < step ? 'done' : 'todo'}
                    className={`h-2 w-onboarding-segment rounded-round max-narrow:w-4 ${index < step ? 'bg-accent' : 'bg-border'}`}
                  />
                ))}
              </div>
              <p className="text-sm text-ink-muted tabular-nums">
                {`${step} of ${onboardingSteps}`}
              </p>
            </div>
          )}
          {skip}
        </div>
        <div className="flex flex-1 flex-col gap-8">{children}</div>
      </section>
    </div>
  );
}

/** A Next that is a plain link (the intro steps). */
export function NextLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link href={href} className={primary}>
      {children}
    </Link>
  );
}

/** A Next that submits the step's form (the questionnaire steps). */
export function NextButton({
  children,
  pending = false,
}: {
  readonly children: ReactNode;
  readonly pending?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`${primary} cursor-pointer border-0 disabled:cursor-wait disabled:opacity-60`}
    >
      {children}
    </button>
  );
}

/** The Skip control's look: a quiet underlined button inside its form. */
export const skipClass =
  'inline-flex min-h-onboarding-touch cursor-pointer items-center border-0 bg-transparent px-3 text-base font-strong text-ink-muted underline underline-offset-4 hover:text-ink';

/** Back (a link to the previous step) and Next, under a rule. */
export function StepFooter({
  backHref,
  next,
}: {
  readonly backHref: string | null;
  readonly next: ReactNode;
}) {
  return (
    <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-5">
      {backHref === null ? (
        <span />
      ) : (
        <Link
          href={backHref}
          className={`${touch} border border-border-strong text-ink`}
        >
          Back
        </Link>
      )}
      {next}
    </div>
  );
}
