import type { AuthorizationInput } from '@daisy/auth/authorization';
import type { LoadedOrganizationCommand } from '@daisy/db/tab';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { CommandDenied } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';

type Authority = Omit<AuthorizationInput, 'capability'>;

/**
 * What the gate decides on for each command: creating asks about the
 * collection, answering an invitation or leaving asks about the sender's
 * own membership, and everything else about the organization.
 */
const resourceOf = (
  principal: TabPrincipal,
  command: OrganizationCommand,
  loaded: LoadedOrganizationCommand,
): Authority['resource'] => {
  if (command.type === 'create-organization')
    return { kind: 'organization_collection', proposedKind: command.kind };
  const { organization, membership } = loaded.authorization;
  if (organization === null) throw new CommandDenied('not-found');
  const own =
    command.type === 'accept-membership' ||
    command.type === 'decline-membership' ||
    (command.type === 'end-membership' && command.userId === principal.userId);
  return own && membership !== null && principal.actorId !== null
    ? {
        kind: 'membership',
        organizationId: organization.organizationId,
        actorId: principal.actorId,
        status: membership,
      }
    : organization;
};

/**
 * The role `organization.roles.manage` weighs: the one given or removed, or
 * none for inviting and ending a membership, which ask only whether the
 * sender manages roles at all. Other commands never ask.
 */
const roleGivenOf = (
  command: OrganizationCommand,
  loaded: LoadedOrganizationCommand,
): AuthorizationInput['context']['roleGiven'] => {
  switch (command.type) {
    case 'give-grant':
    case 'remove-grant':
      return loaded.roleNamed;
    case 'invite-member':
    case 'end-membership':
      return null;
    case 'create-organization':
    case 'update-organization':
    case 'accept-membership':
    case 'decline-membership':
    case 'transfer-ownership':
      return undefined;
  }
};

/** Everything `authorize` needs for an organization command but the capability. */
export const organizationAuthorityOf = (
  principal: TabPrincipal,
  command: OrganizationCommand,
  loaded: LoadedOrganizationCommand,
  context: { readonly now: string; readonly hostingPlan: boolean },
): Authority => {
  const { account, grants } = loaded.authorization;
  const roleGiven = roleGivenOf(command, loaded);
  return {
    principal,
    resource: resourceOf(principal, command, loaded),
    context: {
      account:
        account === null
          ? null
          : { ...account, hostingPlan: context.hostingPlan },
      now: context.now,
      grants,
      ...(roleGiven === undefined ? {} : { roleGiven }),
    },
  };
};
