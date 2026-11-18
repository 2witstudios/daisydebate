import type {
  PreapprovalCommand,
  PreapprovalResult,
} from '@daisy/protocol/beta-preapproval';

export type PreapprovalGrantFact = {
  readonly id: string;
  readonly revision: number;
  readonly claimed: boolean;
  readonly invited: boolean;
};
export type PreapprovalDecision =
  | { readonly kind: 'refused'; readonly code: 'NOT_FOUND' | 'CONFLICT' }
  | { readonly kind: 'remove'; readonly result: PreapprovalResult }
  | {
      readonly kind: 'save';
      readonly queueInvitation: boolean;
      readonly advanceRevision: boolean;
      readonly result: PreapprovalResult;
    };

/** Total command policy over fresh, already-fenced persistence facts. */
export function decidePreapprovalChange(input: {
  readonly command: PreapprovalCommand;
  readonly grant: PreapprovalGrantFact | null;
  readonly claimedAccountInvitable: boolean;
  readonly activeInvitation: boolean;
}): PreapprovalDecision {
  const { command, grant } = input;
  if (
    !grant ||
    (command.operation !== 'add' && command.preapprovalId !== grant.id)
  )
    return { kind: 'refused', code: 'NOT_FOUND' };
  if (
    command.operation !== 'add' &&
    command.expectedRevision !== grant.revision
  )
    return { kind: 'refused', code: 'CONFLICT' };
  const base = {
    commandId: command.commandId,
    preapprovalId: grant.id,
    revision: grant.revision,
  };
  if (command.operation === 'remove')
    return {
      kind: 'remove',
      result: { ...base, outcome: 'removed', mail: 'none' },
    };
  const wantsInvitation =
    command.operation === 'invite' ||
    (command.operation === 'add' && command.invite);
  if (wantsInvitation && grant.claimed && !input.claimedAccountInvitable)
    return { kind: 'refused', code: 'CONFLICT' };
  const queueInvitation =
    wantsInvitation &&
    !input.activeInvitation &&
    (command.operation === 'invite' || !grant.invited);
  const advanceRevision = command.operation === 'invite';
  return {
    kind: 'save',
    queueInvitation,
    advanceRevision,
    result: {
      ...base,
      revision: grant.revision + (advanceRevision ? 1 : 0),
      outcome: 'saved',
      mail: queueInvitation ? 'queued' : 'none',
    },
  };
}

/**
 * The age bands a claimed grant may still invite: the account floor's bands
 * (`ADMITTED_AGE_BANDS` in @daisy/auth, 13 and over since decision 88). The
 * database never imports policy; a unit test holds the two equal.
 */
export const INVITABLE_AGE_BANDS: readonly string[] = [
  '13-15',
  '16-17',
  'adult',
];

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
  input.ageBand !== null &&
  INVITABLE_AGE_BANDS.includes(input.ageBand);
