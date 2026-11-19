import type { GuardianRefusal } from '@daisy/protocol/guardians';

/**
 * One guardian link's state (ADR 0163), as one type in which an impossible
 * link cannot be written: an active link always carries the evidence that
 * made it active, and only a link the child confirmed carries the child's
 * confirmation.
 */
type People = {
  readonly id: string;
  readonly guardianUserId: string;
  readonly minorUserId: string;
  /** The parent's consent evidence, recorded when they asked or created. */
  readonly guardianConsentId: string;
  readonly version: number;
};

/** How an active link became active, with the evidence each way needs. */
export type Activation =
  | { readonly kind: 'created-account' }
  | {
      readonly kind: 'child-confirmed';
      readonly childConfirmationId: string;
    };

export type GuardianLink =
  | (People & { readonly status: 'requested' })
  | (People & {
      readonly status: 'active';
      readonly activation: Activation;
      readonly activatedAt: string;
    })
  | (People & {
      readonly status: 'refused' | 'cancelled';
      readonly closedAt: string;
    })
  | (People & {
      readonly status: 'ended';
      readonly activation: Activation;
      readonly activatedAt: string;
      readonly closedAt: string;
    });

/** What a person does to a link. The person comes from the principal. */
export type GuardianLinkEvent =
  | {
      readonly kind: 'confirm';
      readonly byUserId: string;
      readonly childConfirmationId: string;
      readonly at: string;
    }
  | { readonly kind: 'refuse'; readonly byUserId: string; readonly at: string }
  | { readonly kind: 'cancel'; readonly byUserId: string; readonly at: string }
  | { readonly kind: 'end'; readonly byUserId: string; readonly at: string };

export type GuardianLinkTransition =
  | { readonly kind: 'refused'; readonly refusal: GuardianRefusal }
  | { readonly kind: 'moved'; readonly link: GuardianLink };

const refuse = (refusal: GuardianRefusal): GuardianLinkTransition => ({
  kind: 'refused',
  refusal,
});

/** Whether a link grants its guardian anything. Only an active one does. */
export const grantsGuardian = (link: GuardianLink): boolean =>
  link.status === 'active';

/** The only person each event belongs to: the child answers, the parent withdraws or ends. */
const actorOf = (link: GuardianLink, event: GuardianLinkEvent): string =>
  event.kind === 'confirm' || event.kind === 'refuse'
    ? link.minorUserId
    : link.guardianUserId;

/**
 * The one transition function. Total over every state and event; a person
 * acting on a link that is not theirs to act on is `not-found`, so a
 * refusal never tells a stranger the link exists.
 */
export function transitionGuardianLink(
  link: GuardianLink,
  event: GuardianLinkEvent,
): GuardianLinkTransition {
  if (event.byUserId !== actorOf(link, event)) return refuse('not-found');
  const base = {
    id: link.id,
    guardianUserId: link.guardianUserId,
    minorUserId: link.minorUserId,
    guardianConsentId: link.guardianConsentId,
    version: link.version + 1,
  };
  switch (event.kind) {
    case 'confirm':
      return link.status === 'requested'
        ? {
            kind: 'moved',
            link: {
              ...base,
              status: 'active',
              activation: {
                kind: 'child-confirmed',
                childConfirmationId: event.childConfirmationId,
              },
              activatedAt: event.at,
            },
          }
        : refuse('not-waiting');
    case 'refuse':
    case 'cancel':
      return link.status === 'requested'
        ? {
            kind: 'moved',
            link: {
              ...base,
              status: event.kind === 'refuse' ? 'refused' : 'cancelled',
              closedAt: event.at,
            },
          }
        : refuse('not-waiting');
    case 'end':
      return link.status === 'active'
        ? {
            kind: 'moved',
            link: {
              ...base,
              status: 'ended',
              activation: link.activation,
              activatedAt: link.activatedAt,
              closedAt: event.at,
            },
          }
        : refuse('not-active');
  }
}

/** A parent's request to link an existing account: waits for the child. */
export const requestedLink = (people: Omit<People, 'version'>): GuardianLink => ({
  ...people,
  version: 1,
  status: 'requested',
});

/** The link written with an account the parent created: active from its first sign-in. */
export const createdAccountLink = (
  people: Omit<People, 'version'>,
  at: string,
): GuardianLink => ({
  ...people,
  version: 1,
  status: 'active',
  activation: { kind: 'created-account' },
  activatedAt: at,
});
