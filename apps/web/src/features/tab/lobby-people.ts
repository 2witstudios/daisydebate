import type { LobbyPeopleCommandContext } from './lobby-people-forms';
import type { PeopleCommandModel } from './people-command-model';
type LobbyPeopleAction = {
  readonly model: Extract<
    PeopleCommandModel,
    { kind: 'give-lobby' | 'remove' }
  >;
  readonly context: LobbyPeopleCommandContext;
};
import type { LobbyPeopleView } from '@daisy/protocol/lobby/lobby-people-read';
import type { People } from './people';
import { commandAction } from './action';
import { peopleRoleOf, peopleRoleSelection } from './people-role';

/** The existing People board, projected from lobby grants rather than memberships. */
export const lobbyPeoplePage = (
  view: LobbyPeopleView,
  context: {
    readonly role: string | null;
    readonly basePath: string;
    readonly viewerId: string;
    readonly handle: string;
    readonly nextId: () => string;
  },
): People<LobbyPeopleAction> => {
  const base = {
    lobbyId: view.lobbyId,
    lobbyVersion: view.version,
    handle: context.handle,
  };
  const giveable = view.roles
    .filter((role) => role.giveable)
    .map((role) => ({ value: role.roleId, label: role.name }));
  const { roles, chosen: defaultRole } = peopleRoleSelection(
    view.roles,
    view.people.flatMap((person) => person.grants.map((grant) => grant.roleId)),
    null,
    false,
  );
  const chosen =
    view.roles.find((role) => role.roleId === context.role) ?? defaultRole;
  return {
    give:
      view.capabilities.give && giveable.length
        ? commandAction<LobbyPeopleAction>(
            'Give someone a role',
            {
              model: {
                kind: 'give-lobby',
                roles: giveable,
                lobbyName: view.name,
              },
              context: {
                ...base,
                intent: 'give',
                commandId: context.nextId(),
                roles: giveable.map((role) => role.value),
              },
            },
            true,
          )
        : null,
    people: view.people.map((person) => {
      const grants = person.grants
        .filter((grant) => grant.removable)
        .map((grant) => ({
          value: grant.grantId,
          label:
            view.roles.find((role) => role.roleId === grant.roleId)?.name ??
            'Role',
        }));
      return {
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
        action:
          person.removable && grants.length
            ? commandAction<LobbyPeopleAction>('Change', {
                model: { kind: 'remove', person: person.name, grants },
                context: {
                  ...base,
                  intent: 'remove',
                  commandId: context.nextId(),
                  grants: grants.map((grant) => grant.value),
                },
              })
            : null,
      };
    }),
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
