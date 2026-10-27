import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { systemClock } from '@daisy/clock';
import {
  onboardingHref,
  usernameHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { birthYears } from '../../../../features/account/age-form';
import {
  AGE_HOLD_COOKIE,
  holdRefusal,
} from '../../../../features/account/age-step';
import { readOnboardingEntry } from '../../../../lib/auth-entry';
import { requestHasRecordedAge } from '../../../../lib/request-session';
import { AgeRefusalStep } from '../../../../ui/onboarding/age/age-refusal';
import { AgeStep } from '../../../../ui/onboarding/age/age-step';
import { ageStepAction } from './actions';

export const metadata: Metadata = {
  title: 'Your age',
  robots: { index: false, follow: false },
};

/**
 * The age step, first in onboarding (WAIT-4.6). A browser held after an
 * under-age answer sees that refusal, signed out, before anything else;
 * a member, or an account that already answered, goes on.
 */
export default async function OnboardingAgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // cookies(), not the raw request header: the form action that sets the
  // hold re-renders this page in the same response, and only cookies()
  // reflects a cookie that action just set.
  const held = holdRefusal((await cookies()).get(AGE_HOLD_COOKIE)?.value);
  if (held !== null) return <AgeRefusalStep refusal={held} />;
  const { destination, identity } = await readOnboardingEntry(
    searchParams,
    onboardingHref,
  );
  if (identity.state === 'member') redirect(destination);
  if (await requestHasRecordedAge()) redirect(usernameHref(destination));
  return (
    <AgeStep
      action={ageStepAction.bind(null, destination)}
      years={birthYears(systemClock.now())}
    />
  );
}
