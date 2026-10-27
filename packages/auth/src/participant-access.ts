import { ACCOUNT_AGE_FLOOR, type AgeFloor } from './age-floor';
import type { AgeBand } from './age-band';
import type { BetaAccessState } from '@daisy/protocol';
import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import type { AccountAuthorizationFact } from './authorization-facts';

type AccountBetaState = NonNullable<AccountAuthorizationFact['beta']>['state'];
/** Age bands at or above each account floor (DEC-106: 16 in the beta, 13 after). */
const bandsAtFloor: Record<AgeFloor, readonly AgeBand[]> = {
  13: ['13-15', '16-17', 'adult'],
  16: ['16-17', 'adult'],
};
/**
 * The one participant admission rule (ADR 0075): an approved beta account
 * whose durable age record meets the account floor. A missing age record
 * is no access. Identity, realtime and UI hints ask this, never the raw
 * facts.
 */
export function participantAccess(
  account: {
    readonly beta: { readonly state: AccountBetaState } | null;
    readonly ageBand: AgeBand | null;
  } | null,
): boolean {
  return account?.beta?.state === 'approved' && ageAdmitted(account.ageBand);
}
/** Whether a durable age band meets the account floor; no record never does. */
export function ageAdmitted(band: AgeBand | null): boolean {
  return band !== null && bandsAtFloor[ACCOUNT_AGE_FLOOR].includes(band);
}
/**
 * ADR 0075: a member who is not, or no longer, admitted can always withdraw
 * their own footprint, never add to it or read others' content. These are
 * the exits and own cleanup, with the replay reads of their own commands.
 */
const withdrawals: readonly AuthorizationCapability[] = [
  'room.leave',
  'channel.leave',
  'social.block',
  'channel.reaction.remove',
  'channel.file.cleanup',
  'channel.invitation.decline',
  'channel.invitation.result',
  'channel.group.archive',
  'channel.group.result',
  // ISSUE-692: removing your own message and cancelling your own request or
  // invitation only shrink your own footprint.
  'channel.message.remove',
  'channel.request.cancel',
  // DEC-126: a survivor may always delete what they kept of an erased DM.
  'channel.retained.delete',
  'channel.request.result',
  'channel.invitation.cancel',
];
/** Whether a bound member holds a capability under the admission rule. */
export function admitsCapability(
  capability: AuthorizationCapability,
  account: Parameters<typeof participantAccess>[0],
): boolean {
  return withdrawals.includes(capability) || participantAccess(account);
}

/**
 * The same rule over a human principal's fenced access facts, as the
 * database hands them to a fenced command (Round, attendance, media).
 */
export function admitsPrincipalAccess(
  access: {
    readonly beta: BetaAccessState | null;
    readonly ageBand: AgeBand | null;
  } | null,
): boolean {
  return participantAccess(
    access && {
      beta: access.beta && { state: access.beta },
      ageBand: access.ageBand,
    },
  );
}
