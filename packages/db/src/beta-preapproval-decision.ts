import { ageBandAdmitted } from '@daisy/protocol/age-floor';

/** A consumed grant may invite only its still-matching eligible account. */
export const canInviteClaimedPreapproval = (input: {
  readonly verified: boolean;
  readonly emailMatches: boolean;
  readonly erased: boolean;
  readonly restricted: boolean;
  readonly state: string | null;
  readonly ageBand: string | null;
}): boolean =>
  input.verified &&
  input.emailMatches &&
  !input.erased &&
  !input.restricted &&
  input.state === 'approved' &&
  ageBandAdmitted(input.ageBand);
