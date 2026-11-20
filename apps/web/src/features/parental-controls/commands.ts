import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import type { Database, GuardianSession } from '@daisy/db';
import type {
  ConsentMethod,
  GuardianCommand,
  GuardianRefusal,
  GuardianRequestRef,
} from '@daisy/protocol/guardians';
import { servedNotice } from '../legal/guardian-notices';
import { recordConsent, type ConsentEvidence } from './consent-evidence';
import { decideChildAccount, invitationExpiresAt } from './guardian-invitation';
import { requestedLink, transitionGuardianLink } from './guardian-link';
import { linkStateColumns, readGuardianLink } from './link-row';

type Caller = { readonly userId: string; readonly actorId: string };
type Context = {
  readonly caller: Caller;
  readonly session: GuardianSession;
  readonly at: string;
};
type Delivery =
  | { readonly kind: 'sign-in'; readonly email: string }
  | { readonly kind: 'confirm-link'; readonly email: string }
  | { readonly kind: 'account-not-changed'; readonly email: string };
type Result =
  | { readonly kind: 'accepted'; readonly mail?: Delivery }
  | { readonly kind: 'refused'; readonly refusal: GuardianRefusal };

const accepted: Result = { kind: 'accepted' };
const refused = (refusal: GuardianRefusal): Result => ({
  kind: 'refused',
  refusal,
});
const reservationLost = createAppError(
  'CONFLICT',
  'Child invitation address is reserved',
);
const mailed = (email: string, kind: Delivery['kind']): Result => ({
  kind: 'accepted',
  mail: { email, kind },
});

const isMinor = (age: string | null | undefined) =>
  age === '13-15' || age === '16-17';
const evidence = (context: Context, method: ConsentMethod, version: string) =>
  recordConsent({
    id: createId(),
    personUserId: context.caller.userId,
    method,
    notice: servedNotice(
      method === 'confirmed-link' ? 'child-confirmation' : 'parental-consent',
    ),
    shownVersion: version,
    at: context.at,
  });

async function addRequestedLink(
  context: Context,
  child: string,
  consentId: string,
) {
  const { session, caller, at } = context;
  const now = new Date(at);
  const link = requestedLink({
    id: createId(),
    minorUserId: child,
    guardianUserId: caller.userId,
    guardianConsentId: consentId,
  });
  await session.insertLink({ ...link, createdAt: now, updatedAt: now });
  return link.id;
}

async function ask(context: Context, child: string, consent: ConsentEvidence) {
  await context.session.insertEvidence({
    ...consent,
    recordedAt: new Date(context.at),
  });
  return addRequestedLink(context, child, consent.id);
}

type Account = NonNullable<
  Awaited<ReturnType<GuardianSession['lockAccounts']>>[number]
>;
type Target = Awaited<ReturnType<GuardianSession['personByEmail']>>;
type RequestRow = NonNullable<Awaited<ReturnType<GuardianSession['request']>>>;

async function routeWaitingInvitation(
  context: Context,
  pending: RequestRow & { readonly email: string },
  target: Target,
  child: Account | null | undefined,
): Promise<Result> {
  const { session, at } = context;
  if (
    pending.status === 'open' &&
    (!target || (!target.actorId && target.createdAt > pending.createdAt))
  )
    return mailed(pending.email, 'sign-in');

  const awaiting = pending.requestedLinkId
    ? await session.link(pending.requestedLinkId)
    : null;
  if (pending.status === 'linked') {
    return mailed(
      pending.email,
      awaiting?.status === 'requested' &&
        awaiting.minorUserId === target?.userId &&
        target.emailVerified
        ? 'confirm-link'
        : 'account-not-changed',
    );
  }

  const minor =
    child?.member &&
    !child.erased &&
    target?.emailVerified &&
    child.userId === target.userId &&
    isMinor(child.ageBand)
      ? child
      : null;
  const current = minor ? await session.openLink(minor.userId) : null;
  const linkId =
    minor && !current
      ? await addRequestedLink(context, minor.userId, pending.guardianConsentId)
      : null;
  if (!(await session.linkRequest(pending.id, linkId, new Date(at))))
    throw createAppError('CONFLICT');
  return mailed(
    pending.email,
    linkId || current?.status === 'requested'
      ? 'confirm-link'
      : 'account-not-changed',
  );
}

async function start(
  context: Context,
  cmd: Extract<
    GuardianCommand,
    { type: 'request-link' | 'create-child-account' }
  >,
): Promise<Result> {
  const { caller, session, at } = context;
  const readTarget = () =>
    cmd.type === 'request-link'
      ? session.personByUsername(cmd.username)
      : session.personByEmail(cmd.email);
  const initial = await readTarget();
  const otherActor =
    initial?.actorId === caller.actorId ? null : initial?.actorId;
  const [guardian, child] = await session.lockAccounts(
    otherActor ? [caller.actorId, otherActor] : [caller.actorId],
  );
  const parent = await session.personById(caller.userId);
  if (!parent?.email || parent.actorId !== caller.actorId)
    throw createAppError('AUTHORIZATION');
  const target = await readTarget();
  if (
    !guardian?.member ||
    guardian.restricted ||
    guardian.erased ||
    guardian.userId !== caller.userId
  )
    throw createAppError('AUTHORIZATION');
  if (guardian.ageBand !== 'adult') return refused('not-an-adult');
  if (
    target?.userId !== initial?.userId ||
    target?.actorId !== initial?.actorId
  )
    return cmd.type === 'request-link'
      ? refused('no-such-child')
      : mailed(cmd.email, 'account-not-changed');
  const current =
    child && !child.erased ? await session.openLink(child.userId) : null;
  if (cmd.type === 'request-link') {
    if (!child?.member || child.erased || !isMinor(child.ageBand))
      return refused('no-such-child');
    if (current) return refused('already-linked');
    const consent = evidence(context, 'requested-link', cmd.noticeVersion);
    if (consent.kind === 'refused') return consent;
    await ask(context, child.userId, consent.evidence);
    return target?.email && target.emailVerified
      ? {
          kind: 'accepted',
          mail: { kind: 'confirm-link', email: target.email },
        }
      : accepted;
  }

  const now = new Date(at);
  const pending = await session.liveRequest(cmd.email, now);
  const decision = decideChildAccount(
    {
      now: at,
      parent: { ...guardian, email: parent.email },
      parentInvitedAddress: false,
      holder: target
        ? {
            kind: 'account',
            userId: target.userId,
            ageBand: target.emailVerified ? (child?.ageBand ?? null) : null,
            linkedToParent: current !== null,
          }
        : { kind: 'nobody' },
    },
    cmd,
  );
  if (decision.kind === 'refused') return decision;
  const method =
    decision.kind === 'invite' ? 'created-account' : 'requested-link';
  const consent = evidence(context, method, cmd.noticeVersion);
  if (consent.kind === 'refused') return consent;
  const mail: Delivery = {
    email: cmd.email,
    kind:
      decision.kind === 'invite'
        ? 'sign-in'
        : decision.kind === 'ask-existing' || current?.status === 'requested'
          ? 'confirm-link'
          : 'account-not-changed',
  };
  if (pending)
    return routeWaitingInvitation(
      context,
      { ...pending, email: cmd.email },
      target,
      child,
    );

  const requestedLinkId =
    decision.kind === 'ask-existing'
      ? await ask(context, decision.minorUserId, consent.evidence)
      : null;
  if (requestedLinkId === null)
    await session.insertEvidence({ ...consent.evidence, recordedAt: now });
  const inserted = await session.insertRequest({
    id: createId(),
    guardianUserId: caller.userId,
    guardianConsentId: consent.evidence.id,
    firstName: cmd.firstName,
    birthMonth: cmd.birthMonth,
    email: cmd.email,
    status: decision.kind === 'invite' ? 'open' : 'linked',
    requestedLinkId,
    createdAt: now,
    expiresAt: new Date(invitationExpiresAt(at)),
    closedAt: decision.kind === 'invite' ? null : now,
  });
  if (!inserted) throw reservationLost;
  return { kind: 'accepted', mail };
}

type LinkAction = 'send' | 'cancel' | 'confirm' | 'refuse' | 'end';

async function actOnLink(
  context: Context,
  id: string,
  action: LinkAction,
  noticeVersion?: string,
): Promise<Result> {
  const { caller, session, at } = context;
  const initial = await session.link(id);
  if (!initial) return refused('not-found');
  const childActing = action === 'confirm' || action === 'refuse';
  const owner = childActing ? initial.minorUserId : initial.guardianUserId;
  if (owner !== caller.userId) return refused('not-found');
  const other = await session.personById(
    childActing ? initial.guardianUserId : initial.minorUserId,
  );
  const [acting, counterpart] = await session.lockAccounts(
    other?.actorId ? [caller.actorId, other.actorId] : [caller.actorId],
  );
  if (!acting?.member || acting.erased || acting.userId !== caller.userId)
    throw createAppError('AUTHORIZATION');
  if (
    acting.restricted &&
    action !== 'refuse' &&
    action !== 'cancel' &&
    action !== 'end'
  )
    throw createAppError('AUTHORIZATION');
  if (action === 'confirm' || action === 'send') {
    if (!counterpart?.member || counterpart.erased || counterpart.restricted)
      return refused('not-found');
    if (
      childActing &&
      (counterpart.ageBand !== 'adult' || !isMinor(acting.ageBand))
    )
      return refused('not-a-minor');
    if (
      !childActing &&
      (acting.ageBand !== 'adult' || !isMinor(counterpart.ageBand))
    )
      return refused('not-found');
  }
  const row = await session.link(id);
  if (!row) return refused('not-found');
  if (row.status === 'requested') {
    const invitation = await session.requestForLink(row.id);
    if (invitation && invitation.expiresAt <= new Date(at))
      return refused('not-waiting');
  }
  if (action === 'send') {
    if (row.status !== 'requested') return refused('not-waiting');
    const recipient = await session.personById(row.minorUserId);
    return recipient?.emailVerified && recipient.email
      ? mailed(recipient.email, 'confirm-link')
      : accepted;
  }

  const consent =
    action === 'confirm'
      ? evidence(context, 'confirmed-link', noticeVersion ?? '')
      : null;
  if (consent?.kind === 'refused') return consent;
  const event = {
    byUserId: caller.userId,
    at,
    ...(action === 'confirm'
      ? { kind: action, childConfirmationId: consent?.evidence.id ?? '' }
      : { kind: action }),
  } as const;
  const changed = transitionGuardianLink(readGuardianLink(row), event);
  if (changed.kind === 'refused') return changed;
  const now = new Date(at);
  if (consent)
    await session.insertEvidence({ ...consent.evidence, recordedAt: now });
  if (!(await session.moveLink(row, linkStateColumns(changed.link, now))))
    throw createAppError('CONFLICT');
  if (action === 'refuse' && other?.actorId) {
    await session.fileRefusal({
      reportId: createId(),
      childActorId: caller.actorId,
      guardianActorId: other.actorId,
      now,
    });
  }
  if (action === 'confirm' || action === 'end')
    await session.bumpAuthority(row.guardianUserId, now);
  return accepted;
}

async function actOnRequest(
  context: Context,
  ref: GuardianRequestRef,
  action: 'send' | 'cancel',
): Promise<Result> {
  if (ref.kind === 'link') return actOnLink(context, ref.id, action);
  const { session, caller, at } = context;
  const first = await session.request(ref.id);
  const firstTarget =
    action === 'send' && first?.email
      ? await session.personByEmail(first.email)
      : null;
  const targetActor =
    firstTarget?.actorId !== caller.actorId ? firstTarget?.actorId : null;
  const [account, child] = await session.lockAccounts(
    targetActor ? [caller.actorId, targetActor] : [caller.actorId],
  );
  if (
    !account?.member ||
    account.userId !== caller.userId ||
    account.erased ||
    (action === 'send' && account.restricted)
  )
    throw createAppError('AUTHORIZATION');
  const pending = await session.request(ref.id);
  if (!pending) return refused('not-found');
  const { id, status, email, requestedLinkId, expiresAt } = pending;
  if (
    !email ||
    expiresAt <= new Date(at) ||
    (status !== 'open' && status !== 'linked')
  )
    return refused('not-waiting');

  if (action === 'send') {
    if (account.ageBand !== 'adult') return refused('not-an-adult');
    const target = await session.personByEmail(email);
    if (
      target?.userId !== firstTarget?.userId ||
      target?.actorId !== firstTarget?.actorId
    )
      return mailed(email, 'account-not-changed');
    return routeWaitingInvitation(
      context,
      { ...pending, email },
      target,
      child,
    );
  }
  if (requestedLinkId) {
    const row = await session.link(requestedLinkId);
    if (row?.status === 'requested') {
      const changed = transitionGuardianLink(readGuardianLink(row), {
        kind: 'cancel',
        byUserId: caller.userId,
        at,
      });
      if (
        changed.kind === 'moved' &&
        !(await session.moveLink(
          row,
          linkStateColumns(changed.link, new Date(at)),
        ))
      )
        throw createAppError('CONFLICT');
    }
  }
  if (!(await session.cancelRequest(id, new Date(at))))
    throw createAppError('CONFLICT');
  return accepted;
}

export function runGuardianCommand(
  context: Context,
  command: GuardianCommand,
): Promise<Result> {
  switch (command.type) {
    case 'create-child-account':
    case 'request-link':
      return start(context, command);
    case 'send-again':
    case 'cancel-request':
      return actOnRequest(
        context,
        command.request,
        command.type === 'send-again' ? 'send' : 'cancel',
      );
    case 'confirm-parent':
      return actOnLink(
        context,
        command.linkId,
        'confirm',
        command.noticeVersion,
      );
    case 'refuse-parent':
      return actOnLink(context, command.linkId, 'refuse');
    case 'end-link':
      return actOnLink(context, command.linkId, 'end');
  }
}

/** A conflicting address reservation leaves no evidence or token for a losing request. */
export async function submitGuardianCommand(
  store: Database['guardians'],
  caller: Caller,
  at: string,
  command: GuardianCommand,
): Promise<Result> {
  try {
    return await store.forSubject(caller.userId, (session) =>
      runGuardianCommand({ session, caller, at }, command),
    );
  } catch (error) {
    if (error === reservationLost && command.type === 'create-child-account')
      return mailed(command.email, 'account-not-changed');
    throw error;
  }
}
