import { fenceTabAccountRead } from './account-read-fence';
import { loadGrantRows } from './grant-rows';
import { eq } from 'drizzle-orm';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { namedPersonOf } from './organization-facts';
import type { Tx } from '../tx';
import { takeLock, transactionLocks } from '../locks';

const foundOrganization = async (
  tx: Tx,
  organizationId: string,
): Promise<{ readonly id: string } | undefined> => {
  const [organization] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return organization;
};

/**
 * The tenant an organization command's transaction may reach: the
 * organization it creates (the id minted at the edge) or the one it names,
 * once its row is found, and a lobby a grant is given at once that lobby is
 * found to be the organization's. The sender is always the subject, so
 * their own memberships and grants elsewhere stay readable.
 */
const organizationScope = async (
  tx: Tx,
  input: {
    readonly senderUserId: string;
    readonly command: OrganizationCommand;
    readonly newId: string;
  },
): Promise<TenantScope> => {
  const subject = { subjectUserId: input.senderUserId };
  const { command } = input;
  if (command.type === 'create-organization')
    return { ...subject, organizationId: input.newId };
  if (
    (command.type === 'give-grant' || command.type === 'remove-grant') &&
    command.scope.kind === 'lobby'
  ) {
    const [lobby] = await tx
      .select({ id: lobbies.id, organizationId: lobbies.ownerOrganizationId })
      .from(lobbies)
      .where(eq(lobbies.id, command.scope.lobbyId));
    return {
      ...subject,
      lobbyId: lobby?.id,
      organizationId: lobby?.organizationId ?? undefined,
    };
  }
  const organizationId =
    command.type === 'give-grant' || command.type === 'remove-grant'
      ? command.scope.kind === 'organization'
        ? command.scope.organizationId
        : undefined
      : command.organizationId;
  if (!organizationId) return subject;
  const organization = await foundOrganization(tx, organizationId);
  if (organization === undefined) return subject;
  return { ...subject, organizationId: organization.id };
};

/**
 * Fences the open transaction to the command's tenant before anything is
 * read, and answers the scope it set, for the steps that visit a lobby's.
 */
export const fenceOrganizationCommand = async (
  tx: Tx,
  input: Parameters<typeof organizationScope>[1],
): Promise<TenantScope> => {
  // Organizations and lobbies are open to read, so the rows are found
  // under the subject alone before the scope widens to them.
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  const scope = await organizationScope(tx, input);
  await scopeTransaction(tx, scope);
  const grant =
    input.command.type === 'remove-grant' &&
    (scope.organizationId || scope.lobbyId)
      ? (
          await loadGrantRows(tx, {
            ...(scope.organizationId
              ? {
                  organizationId: scope.organizationId,
                  ...(scope.lobbyId ? { lobbyId: scope.lobbyId } : {}),
                }
              : { lobbyId: scope.lobbyId! }),
            userIds: [],
            grantIds: [input.command.grantId],
          })
        ).find((row) =>
          scope.lobbyId
            ? row.scopeKind === 'lobby' && row.lobbyId === scope.lobbyId
            : row.scopeKind === 'organization' &&
              row.organizationId === scope.organizationId,
        )
      : undefined;
  const named = grant?.userId ?? namedPersonOf(input.command);
  await lockTabCommandAccounts(
    tx,
    named === null ? [input.senderUserId] : [input.senderUserId, named],
  );
  if (input.command.type === 'create-organization') {
    await takeLock(
      tx,
      transactionLocks.tabOrganizationHandle(input.command.handle),
    );
  }
  return scope;
};

/** Fences a read of one organization to it, once its row is found; answers the scope. */
export const fenceOrganizationRead = async (
  tx: Tx,
  input: { readonly viewerUserId: string; readonly organizationId: string },
): Promise<TenantScope> => {
  const subject = { subjectUserId: input.viewerUserId };
  await scopeTransaction(tx, subject);
  const organization = await foundOrganization(tx, input.organizationId);
  const scope = { ...subject, organizationId: organization?.id };
  await scopeTransaction(tx, scope);
  await fenceTabAccountRead(tx, input.viewerUserId);
  if (scope.organizationId)
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId))
      .for('share');
  return scope;
};
