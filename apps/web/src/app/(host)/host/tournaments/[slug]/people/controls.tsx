import { createId } from '@paralleldrive/cuid2';
import type { LobbyPeopleView } from '@daisy/protocol/lobby/lobby-people-read';
import { LobbyPeopleCommandForm } from '../../../../../../ui/tab/people/lobby-people-command-form';
import { lobbyPeopleCommandAction } from './actions';

/** Every bound identity comes from the scoped read; each command evaluates current authority again. */
export function lobbyPeopleControls(view: LobbyPeopleView, handle: string) {
  const base = { lobbyId: view.lobbyId, lobbyVersion: view.version, handle };
  const roles = view.roles
    .filter((role) => role.giveable)
    .map((role) => ({ value: role.roleId, label: role.name }));
  return {
    give:
      view.capabilities.give && roles.length > 0 ? (
        <LobbyPeopleCommandForm
          model={{ kind: 'give-lobby', roles, lobbyName: view.name }}
          action={lobbyPeopleCommandAction.bind(null, {
            ...base,
            commandId: createId(),
            intent: 'give',
            roles: roles.map((role) => role.value),
          })}
        />
      ) : null,
    people: view.people.map((person) => {
      if (person.owner)
        return (
          <span key={person.userId} className="text-sm text-ink-muted">
            Everything
          </span>
        );
      const grants = person.grants
        .filter((grant) => grant.removable)
        .map((grant) => ({
          value: grant.grantId,
          label:
            view.roles.find((role) => role.roleId === grant.roleId)?.name ??
            'Role',
        }));
      return person.removable && grants.length > 0 ? (
        <LobbyPeopleCommandForm
          key={person.userId}
          model={{ kind: 'remove', person: person.name, grants }}
          action={lobbyPeopleCommandAction.bind(null, {
            ...base,
            commandId: createId(),
            intent: 'remove',
            grants: grants.map((grant) => grant.value),
          })}
        />
      ) : null;
    }),
  };
}
