import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import type { GuardianSession } from '@daisy/db';
import type {
  ConsentMethod,
  GuardianCommand,
  GuardianRefusal,
  GuardianRequestRef,
} from '@daisy/protocol/guardians';
import { servedNotice } from '../legal/guardian-notices';
import { recordConsent, type ConsentEvidence } from './consent-evidence';
import {
  decideChildAccount,
  invitationExpiresAt,
  invitationLive,
} from './guardian-invitation';
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

async function ask(context: Context, child: string, consent: ConsentEvidence) {
  const { session, caller, at } = context;
  const now = new Date(at);
  const link = requestedLink({
    id: createId(),
    minorUserId: child,
    guardianUserId: caller.userId,
    guardianConsentId: consent.id,
  });
  await session.insertEvidence({ ...consent, recordedAt: now });
  await session.insertLink({ ...link, createdAt: now, updatedAt: now });
  return link.id;
}

async function start(
  context: Context,
  cmd: Extract<
    GuardianCommand,
    { type: 'request-link' | 'create-child-account' }
  >,
): Promise<Result> {
  const { caller, session, at } = context;
  const parent = await session.personById(caller.userId);
  if (!parent?.email || parent.actorId !== caller.actorId)
    throw createAppError('AUTHORIZATION');
  const target =
    cmd.type === 'request-link'
      ? await session.personByUsername(cmd.username)
      : await session.personByEmail(cmd.email);
  const otherActor =
    target?.actorId === caller.actorId ? null : target?.actorId;
  const [guardian, child] = await session.lockAccounts(
    otherActor ? [caller.actorId, otherActor] : [caller.actorId],
  );
  if (
    !guardian?.member ||
    guardian.restricted ||
    guardian.erased ||
    guardian.userId !== caller.userId
  )
    throw createAppError('AUTHORIZATION');
  if (guardian.ageBand !== 'adult') return refused('not-an-adult');
  const current =
    child && !child.erased ? await session.openLink(child.userId) : null;
  if (cmd.type === 'request-link') {
    if (!child?.member || child.erased || !isMinor(child.ageBand))
      return refused('no-such-child');
    if (current) return refused('already-linked');
    const consent = evidence(context, 'requested-link', cmd.noticeVersion);
    if (consent.kind === 'refused') return consent;
    await ask(context, child.userId, consent.evidence);
    return target?.email
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
            ageBand: child?.ageBand ?? null,
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
  if (pending) return { kind: 'accepted', mail };

  const requestedLinkId =
    decision.kind === 'ask-existing'
      ? await ask(context, decision.minorUserId, consent.evidence)
      : null;
  if (requestedLinkId === null)
    await session.insertEvidence({ ...consent.evidence, recordedAt: now });
  await session.insertRequest({
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
  if (action === 'send') {
    if (row.status !== 'requested') return refused('not-waiting');
    return other?.email
      ? { kind: 'accepted', mail: { kind: 'confirm-link', email: other.email } }
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
  const [account] = await session.lockAccounts([caller.actorId]);
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

  if (action === 'send')
    return {
      kind: 'accepted',
      mail: {
        kind: invitationLive({ status, expiresAt: expiresAt.toISOString() }, at)
          ? 'sign-in'
          : requestedLinkId
            ? 'confirm-link'
            : 'account-not-changed',
        email,
      },
    };
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
