import type { LobbyPeopleView } from '@daisy/protocol/lobby/lobby-people-read';
import type { People } from './people';
import { unavailableAction } from './action';
import { peopleRoleOf, peopleRoleSelection } from './people-role';

/** The existing People board, projected from lobby grants rather than memberships. */
export const lobbyPeoplePage = (
  view: LobbyPeopleView,
  context: {
    readonly role: string | null;
    readonly basePath: string;
    readonly viewerId: string;
  },
): People => {
  const { roles, chosen: defaultRole } = peopleRoleSelection(
    view.roles,
    view.people.flatMap((person) => person.grants.map((grant) => grant.roleId)),
    null,
    false,
  );
  const chosen =
    view.roles.find((role) => role.roleId === context.role) ?? defaultRole;
  return {
    give: unavailableAction('Give someone a role', true),
    people: view.people.map((person) => ({
      id: person.userId,
      name: person.userId === context.viewerId ? 'You' : person.name,
      owner: person.owner,
      detail: person.owner
        ? 'Owner · can’t be removed here'
        : person.grants
            .map(
              (grant) =>
                `${view.roles.find((role) => role.roleId === grant.roleId)?.name ?? 'Role'} · ${view.name} only${grant.expiresAt === null ? '' : ` · ends ${grant.expiresAt.slice(0, 10)} UTC`}`,
            )
            .join(' · '),
      conflict: null,
      action: person.removable ? unavailableAction('Change') : null,
    })),
    roles: roles.map((role) => ({
      id: role.roleId,
      name: role.name,
      href: `${context.basePath}?${new URLSearchParams({ role: role.roleId })}`,
      selected: role.roleId === chosen?.roleId,
    })),
    role: peopleRoleOf(
      chosen ?? null,
      "Whatever a role allows, anyone connected to a room is handled by that tournament's setting.",
    ),
  };
};
