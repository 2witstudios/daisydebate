import { createId } from '@paralleldrive/cuid2';
import type { OrganizationPeopleView } from '@daisy/protocol/lobby/organization-read';
import { PeopleCommandForm } from '../../../../../../ui/tab/people/people-command-form';
import { peopleCommandAction } from './actions';

/** Binds the current snapshot's identities and guard; the operation still evaluates every permission. */
export function peopleControls(view: OrganizationPeopleView, handle: string) {
  const base = {
    organizationId: view.organizationId,
    organizationVersion: view.version,
    lobbies: view.lobbies,
    handle,
  };
  const members = view.people
    .filter((person) => person.membership === 'active' && !person.owner)
    .map((person) => ({ value: person.userId, label: person.name }));
  const roles = view.roles
    .filter((role) => role.preset)
    .map((role) => ({ value: role.roleId, label: role.name }));
  return {
    give:
      view.capabilities.give && members.length && roles.length ? (
        <PeopleCommandForm
          model={{
            kind: 'give',
            members,
            roles,
            scopes: [
              { value: 'organization', label: 'Whole organization' },
              ...view.lobbies.map((lobby) => ({
                value: lobby.lobbyId,
                label: `${lobby.name}${lobby.closed ? ' (closed)' : ''}`,
              })),
            ],
          }}
          action={peopleCommandAction.bind(null, {
            ...base,
            commandId: createId(),
            intent: 'give',
          })}
        />
      ) : null,
    people: view.people.map((person) =>
      person.owner ? (
        <span key={person.userId} className="text-sm text-ink-muted">
          Everything
        </span>
      ) : person.membership === 'invited' ? (
        view.capabilities.cancelInvitation ? (
          <PeopleCommandForm
            key={person.userId}
            model={{ kind: 'cancel', person: person.name }}
            action={peopleCommandAction.bind(null, {
              ...base,
              commandId: createId(),
              intent: 'cancel',
              userId: person.userId,
              membershipVersion: person.membershipVersion,
            })}
          />
        ) : (
          <span key={person.userId} className="text-sm text-ink-muted">
            Invitation pending
          </span>
        )
      ) : person.removable ? (
        <PeopleCommandForm
          key={person.userId}
          model={{
            kind: 'remove',
            person: person.name,
            grants: person.grants.map((grant) => ({
              value: grant.grantId,
              label: `${view.roles.find((role) => role.roleId === grant.roleId)?.name ?? 'Role'} · ${grant.scope.kind === 'organization' ? 'Whole organization' : grant.scope.name}`,
            })),
          }}
          action={peopleCommandAction.bind(null, {
            ...base,
            commandId: createId(),
            intent: 'remove',
            grants: person.grants.map((grant) => ({
              grantId: grant.grantId,
              scope: grant.scope,
            })),
          })}
        />
      ) : null,
    ),
  };
}
