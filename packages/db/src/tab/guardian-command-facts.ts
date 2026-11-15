import { and, eq, inArray } from 'drizzle-orm';
import type { GuardianCommand } from '@daisy/protocol/lobby/guardian-command';
import {
  guardianLinks,
  restrictions,
  restrictionLobbies,
} from '../schema/guardian-links';
import { lobbies } from '../schema/lobbies';
import { actors } from '../schema/actors';
import { scopeTransaction } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { loadAuthorityContext } from './authority-context';
import { loadMemberships } from './organization-facts';
import { loadTabAccount } from './boundary';
import type { TabTransaction } from './tab-transaction';
export type GuardianCommandInput = {
  readonly senderUserId: string;
  readonly subjectUserId: string;
  readonly command: GuardianCommand;
  readonly newId: string;
};
/** The relationship's people or school changed while its account fences waited. */
export class GuardianPeopleChanged extends Error {}
/** Named family facts; no organization or lobby owns the protected subject's journal. */
export const loadGuardianCommandFacts = async (
  tx: TabTransaction,
  input: GuardianCommandInput,
) => {
  const { command } = input;
  await scopeTransaction(tx, { subjectUserId: input.subjectUserId });
  const [initial] =
    command.type === 'create-guardian-link'
      ? []
      : await tx
          .select()
          .from(guardianLinks)
          .where(
            and(
              eq(guardianLinks.id, command.guardianLinkId),
              eq(guardianLinks.minorUserId, input.subjectUserId),
            ),
          );
  if (command.type !== 'create-guardian-link' && !initial) return null;
  const subjectUserId =
    command.type === 'create-guardian-link'
      ? command.wardUserId
      : initial!.minorUserId;
  if (subjectUserId !== input.subjectUserId) return null;
  const guardianUserId =
    command.type === 'create-guardian-link' || command.type === 'add-guardian'
      ? command.guardianUserId
      : initial!.guardianUserId;
  const authorityGuardianUserId = initial?.guardianUserId ?? guardianUserId;
  const schoolId =
    command.type === 'create-guardian-link'
      ? command.through.kind === 'school'
        ? command.through.organizationId
        : null
      : initial!.viaOrganizationId;
  await lockTabCommandAccounts(tx, [
    input.senderUserId,
    subjectUserId,
    guardianUserId,
    authorityGuardianUserId,
  ]);
  const schoolScope = {
    subjectUserId: input.senderUserId,
    ...(schoolId ? { organizationId: schoolId } : {}),
  };
  await scopeTransaction(tx, schoolScope);
  const authorization = await loadAuthorityContext(
    tx,
    schoolScope,
    input.senderUserId,
    'share',
  );
  const [membership] = schoolId
    ? await loadMemberships(tx, schoolId, [guardianUserId])
    : [];
  const personScope = { subjectUserId };
  await scopeTransaction(tx, personScope);
  const [link] = initial
    ? await tx
        .select()
        .from(guardianLinks)
        .where(eq(guardianLinks.id, initial.id))
        .for('update')
    : [];
  if (
    initial &&
    (!link ||
      link.minorUserId !== initial.minorUserId ||
      link.guardianUserId !== initial.guardianUserId ||
      link.viaOrganizationId !== initial.viaOrganizationId)
  )
    throw new GuardianPeopleChanged();
  const ward = await loadTabAccount(tx, subjectUserId, personScope);
  await scopeTransaction(tx, { subjectUserId: guardianUserId });
  const guardian = await loadTabAccount(tx, guardianUserId, {
    subjectUserId: guardianUserId,
  });
  await scopeTransaction(tx, personScope);
  const subjectLinks = await tx
    .select()
    .from(guardianLinks)
    .where(eq(guardianLinks.minorUserId, subjectUserId));
  const [restriction] = link
    ? await tx
        .select()
        .from(restrictions)
        .where(eq(restrictions.guardianLinkId, link.id))
    : [];
  const allowed = restriction
    ? await tx
        .select({ lobbyId: restrictionLobbies.lobbyId })
        .from(restrictionLobbies)
        .where(
          eq(restrictionLobbies.guardianLinkId, restriction.guardianLinkId),
        )
    : [];
  const namedLobbies =
    command.type === 'set-restriction' && command.allowedLobbyIds.length
      ? await tx
          .select({ id: lobbies.id, closedAt: lobbies.closedAt })
          .from(lobbies)
          .where(inArray(lobbies.id, command.allowedLobbyIds))
      : [];
  const people = await tx
    .select({ userId: actors.userId, actorId: actors.id })
    .from(actors)
    .where(inArray(actors.userId, [subjectUserId, authorityGuardianUserId]));
  return {
    subjectUserId,
    guardianUserId,
    link: link ?? null,
    ward,
    guardian,
    authorization,
    guardianActorId:
      people.find((person) => person.userId === authorityGuardianUserId)
        ?.actorId ?? null,
    wardActorId:
      people.find((person) => person.userId === subjectUserId)?.actorId ?? null,
    guardianSchoolMembership: membership?.status ?? null,
    openLinkExists: subjectLinks.some(
      (one) => one.guardianUserId === guardianUserId && one.status !== 'ended',
    ),
    wardOtherActiveLinks: subjectLinks.filter(
      (one) => one.id !== link?.id && one.status === 'active',
    ).length,
    lobbies: namedLobbies.map((one) => ({
      id: one.id,
      closedAt: one.closedAt?.toISOString() ?? null,
    })),
    restriction: restriction
      ? { ...restriction, lobbyIds: allowed.map((one) => one.lobbyId) }
      : null,
  };
};
export type LoadedGuardianCommand = NonNullable<
  Awaited<ReturnType<typeof loadGuardianCommandFacts>>
>;
