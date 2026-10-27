import { ACCOUNT_AGE_FLOOR } from '@daisy/auth/age-floor';
import type { AgeRefusal } from '../../../features/account/age-step';
import {
  AuthFrame,
  AuthHeading,
  taglinePanel,
} from '../../auth/auth-frame/auth-frame';

const titles: Readonly<Record<AgeRefusal, string>> = {
  'under-13': 'Daisy is for people 13 and older.',
  'below-floor': `The Daisy beta is open to people ${ACCOUNT_AGE_FLOOR} and older for now.`,
};

/**
 * The neutral, signed-out answer to an age below the floor (WAIT-4.7): the
 * account that gave it is already gone and nothing it entered was kept.
 * It names no other age that would pass and offers no way to answer again.
 */
export function AgeRefusalStep({ refusal }: { readonly refusal: AgeRefusal }) {
  return (
    <AuthFrame panel={taglinePanel}>
      <AuthHeading eyebrow="Sorry" title={titles[refusal]} muted>
        We haven’t kept anything you entered.
      </AuthHeading>
      <a href="/" className="self-start text-md font-semibold">
        Back to Daisy
      </a>
    </AuthFrame>
  );
}
