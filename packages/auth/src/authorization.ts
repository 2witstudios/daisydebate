/** Current producer facts only. Neither preferences nor client claims grant access. */
export type AuthorizationPrincipal =
  | { readonly kind: 'anonymous' }
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly actorId: string | null;
    };
export type AuthorizationCapability =
  | 'room.list'
  | 'room.create'
  | 'room.read'
  | 'room.join'
  | 'room.manage'
  | 'room.ready'
  | 'room.leave'
  | 'channel.read'
  | 'channel.post'
  | 'channel.manage'
  | 'channel.subscribe';
export type AccountAuthorizationFact = {
  readonly userId: string;
  readonly actorId: string | null;
  readonly member: boolean;
  readonly erased: boolean;
  readonly revision: number;
};
export type RoomAuthorizationFact = {
  readonly kind: 'room';
  readonly roomId: string;
  readonly hostActorId: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly status: string;
  readonly revision: number;
  readonly participants: readonly {
    readonly actorId: string;
    readonly role: string;
    readonly slot: number;
  }[];
};
/** MSG owns the underlying pair/grant projection and its transactional fence. */
export type ChannelAuthorizationFact = {
  readonly kind: 'channel';
  readonly channelId: string;
  readonly policyKey: string;
  readonly policyRevision: number;
  readonly lifecycle: 'active' | 'archived';
  readonly revision: number;
  readonly authority:
    | {
        readonly kind: 'dm';
        readonly lowActorId: string;
        readonly highActorId: string;
        readonly state: 'pending' | 'accepted' | 'declined' | 'cancelled';
        readonly blocked: boolean;
        readonly revision: number;
      }
    | {
        readonly kind: 'private_group';
        readonly actorId: string;
        readonly role: 'manager' | 'member' | null;
        readonly generation: number;
      };
};
export type AuthorizationInput = {
  readonly principal: AuthorizationPrincipal;
  readonly capability: AuthorizationCapability;
  readonly resource:
    | RoomAuthorizationFact
    | ChannelAuthorizationFact
    | { readonly kind: 'room_collection' };
  readonly context: {
    readonly account: AccountAuthorizationFact | null;
    /** Explicit producer-approved current policy result; absence never enables posting. */
    readonly socialReading?: {
      readonly channelId: string;
      readonly policyKey: string;
      readonly policyRevision: number;
      readonly allowed: boolean;
    };
    readonly socialPosting?: {
      readonly channelId: string;
      readonly policyKey: string;
      readonly policyRevision: number;
      readonly allowed: boolean;
    };
  };
};
export type AuthorizationDecision =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason:
        'denied' | 'account-erased' | 'unauthenticated' | 'missing-capability';
    };
const deny = (
  reason: Extract<AuthorizationDecision, { allow: false }>['reason'],
): AuthorizationDecision => ({ allow: false, reason });
const allow: AuthorizationDecision = { allow: true };
/** Pure evaluation. Mutations must load under producer locks, then evaluate again after waits. */
export function authorize({
  principal,
  capability,
  resource,
  context,
}: AuthorizationInput): AuthorizationDecision {
  const valid =
    capability === 'room.create' || capability === 'room.list'
      ? resource.kind === 'room_collection'
      : capability.startsWith('room.')
        ? resource.kind === 'room'
        : resource.kind === 'channel';
  if (!valid) return deny('denied');
  const account = context.account;
  if (account?.erased) return deny('account-erased');
  if (principal.kind !== 'user') return deny('unauthenticated');
  if (
    !account ||
    account.userId !== principal.userId ||
    account.actorId !== principal.actorId ||
    !account.member ||
    principal.actorId === null ||
    !Number.isSafeInteger(account.revision) ||
    account.revision < 1
  )
    return deny('missing-capability');
  if (resource.kind === 'room_collection') return allow;
  if (!Number.isSafeInteger(resource.revision) || resource.revision < 1)
    return deny('denied');
  if (resource.kind === 'room') {
    const host = resource.hostActorId === principal.actorId;
    const seated = resource.participants.some(
      (p) => p.actorId === principal.actorId,
    );
    const readable =
      resource.visibility === 'public' ||
      resource.visibility === 'unlisted' ||
      host ||
      seated;
    if (capability === 'room.read' || capability === 'room.join')
      return readable ? allow : deny('missing-capability');
    if (capability === 'room.manage')
      return host ? allow : deny('missing-capability');
    return seated ? allow : deny('missing-capability');
  }
  const authority = resource.authority;
  const entitled =
    authority.kind === 'dm'
      ? authority.state === 'accepted' &&
        [authority.lowActorId, authority.highActorId].includes(
          principal.actorId,
        )
      : authority.actorId === principal.actorId && authority.role !== null;
  if (!entitled) return deny('missing-capability');
  const reading = context.socialReading;
  if (
    !reading ||
    !reading.allowed ||
    reading.channelId !== resource.channelId ||
    reading.policyKey !== resource.policyKey ||
    reading.policyRevision !== resource.policyRevision
  )
    return deny('missing-capability');
  if (capability === 'channel.read' || capability === 'channel.subscribe')
    return allow;
  if (capability === 'channel.manage')
    return authority.kind === 'private_group' && authority.role === 'manager'
      ? allow
      : deny('missing-capability');
  const policy = context.socialPosting;
  return resource.lifecycle === 'active' &&
    !(authority.kind === 'dm' && authority.blocked) &&
    policy?.allowed === true &&
    policy.channelId === resource.channelId &&
    policy.policyKey === resource.policyKey &&
    policy.policyRevision === resource.policyRevision
    ? allow
    : deny('missing-capability');
}
