import { and, eq } from 'drizzle-orm';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

const foundOrganization = async (
  tx: TabTransaction,
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
  tx: TabTransaction,
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
  const organization = await foundOrganization(tx, command.organizationId);
  if (organization === undefined) return subject;
  if (command.type !== 'give-grant' || command.scope.kind !== 'lobby')
    return { ...subject, organizationId: organization.id };
  const [lobby] = await tx
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(
      and(
        eq(lobbies.id, command.scope.lobbyId),
        eq(lobbies.ownerOrganizationId, organization.id),
      ),
    );
  return { ...subject, organizationId: organization.id, lobbyId: lobby?.id };
};

/** Fences the open transaction to the command's tenant before anything is read. */
export const fenceOrganizationCommand = async (
  tx: TabTransaction,
  input: Parameters<typeof organizationScope>[1],
): Promise<void> => {
  // Organizations and lobbies are open to read, so the rows are found
  // under the subject alone before the scope widens to them.
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  await scopeTransaction(tx, await organizationScope(tx, input));
};

/** Fences a read of one organization to it, once its row is found. */
export const fenceOrganizationRead = async (
  tx: TabTransaction,
  input: { readonly viewerUserId: string; readonly organizationId: string },
): Promise<void> => {
  const subject = { subjectUserId: input.viewerUserId };
  await scopeTransaction(tx, subject);
  const organization = await foundOrganization(tx, input.organizationId);
  await scopeTransaction(tx, { ...subject, organizationId: organization?.id });
};
