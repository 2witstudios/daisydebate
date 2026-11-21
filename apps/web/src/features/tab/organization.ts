import { instantMs } from '@daisy/clock';
import type { PeopleCommandContext } from './organization-people-forms';
import type { PeopleCommandModel } from './people-command-model';
type OrganizationPeopleAction = {
  readonly model: Exclude<PeopleCommandModel, { kind: 'give-lobby' }>;
  readonly context: PeopleCommandContext;
};
import type { People, PersonRow } from './people';
import {
  peopleRoleOf,
  peopleRoleSlug as roleSlug,
  peopleRoleSelection,
} from './people-role';
import type {
  OrganizationPeopleView,
  OrganizationPerson,
} from '@daisy/protocol/lobby/organization-read';
import { commandAction } from './action';

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
] as const;
const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const DAY_MS = 86_400_000;
const dayIndex = (instant: string) => Math.floor(instantMs(instant) / DAY_MS);

/** A UTC day as host screens word it: `14 Nov`. */
const dayWords = (instant: string): string => {
  const date = new Date(instant);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()] ?? ''}`;
};
/** Whole days from one instant's day back to another's. */
export const daysBefore = (earlier: string, now: string): number =>
  dayIndex(now) - dayIndex(earlier);
/** A day within the coming week by its weekday, a later one by its date. */
const comingDayWords = (instant: string, now: string): string =>
  daysBefore(now, instant) < 7
    ? (weekdays[new Date(instant).getUTCDay()] ?? '')
    : dayWords(instant);

const joined = (parts: readonly (string | null)[]) =>
  parts.filter((part): part is string => part !== null).join(' · ');

const handlingWords = {
  denied: 'they are refused',
  second_confirms: 'a second person confirms',
  flagged: 'it goes ahead, flagged',
} as const;

/** An organization's people page from its people read. */
export function organizationPeoplePage(
  view: OrganizationPeopleView,
  context: {
    readonly role: string | null;
    readonly basePath: string;
    readonly viewerId: string;
    readonly now: string;
    readonly handle: string;
    readonly nextId: () => string;
  },
): People<OrganizationPeopleAction> {
  const base = {
    organizationId: view.organizationId,
    organizationVersion: view.version,
    lobbies: view.lobbies,
    handle: context.handle,
  };
  const giveable = view.roles
    .filter((role) => role.preset)
    .map((role) => ({ value: role.roleId, label: role.name }));
  const members = view.people
    .filter((person) => person.membership === 'active' && !person.owner)
    .map((person) => ({ value: person.userId, label: person.name }));
  const { roles, chosen } = peopleRoleSelection(
    view.roles,
    view.people.flatMap((person) => person.grants.map((grant) => grant.roleId)),
    context.role,
  );
  const roleName = (roleId: string) =>
    view.roles.find((role) => role.roleId === roleId)?.name ?? '';
  const person = (
    member: OrganizationPerson,
  ): PersonRow<OrganizationPeopleAction> => {
    const grants = member.grants.map((grant) =>
      joined([
        member.membership === 'invited'
          ? `Invited as ${roleName(grant.roleId)}`
          : roleName(grant.roleId),
        grant.scope.kind === 'organization'
          ? 'whole league'
          : `${grant.scope.name} only`,
        grant.expiresAt === null
          ? null
          : `ends ${comingDayWords(grant.expiresAt, context.now)}`,
        member.membership === 'invited' ? 'not yet accepted' : null,
      ]),
    );
    return {
      id: member.userId,
      name: member.userId === context.viewerId ? 'You' : member.name,
      detail: member.owner
        ? `Owner of ${view.name} · can't be removed by anyone else`
        : grants.join(' · '),
      conflict:
        member.conflicts
          .map((conflict) =>
            conflict.basis === 'school_entry' && conflict.school
              ? `Coaches at ${conflict.school.name}, which has ${conflict.entryCount} entries here`
              : null,
          )
          .find((words) => words !== null) ?? null,
      owner: member.owner,
      action: member.owner
        ? null
        : member.membership === 'invited'
          ? view.capabilities.cancelInvitation
            ? commandAction<OrganizationPeopleAction>('Cancel invite', {
                model: { kind: 'cancel', person: member.name },
                context: {
                  ...base,
                  commandId: context.nextId(),
                  intent: 'cancel',
                  userId: member.userId,
                  membershipVersion: member.membershipVersion,
                },
              })
            : null
          : member.removable
            ? commandAction<OrganizationPeopleAction>('Change', {
                model: {
                  kind: 'remove',
                  person: member.name,
                  grants: member.grants.map((grant) => ({
                    value: grant.grantId,
                    label: `${roleName(grant.roleId) || 'Role'} · ${grant.scope.kind === 'organization' ? 'Whole organization' : grant.scope.name}`,
                  })),
                },
                context: {
                  ...base,
                  commandId: context.nextId(),
                  intent: 'remove',
                  grants: member.grants.map(({ grantId, scope }) => ({
                    grantId,
                    scope,
                  })),
                },
              })
            : null,
    };
  };
  return {
    give:
      view.capabilities.give && members.length && giveable.length
        ? commandAction<OrganizationPeopleAction>(
            'Give someone a role',
            {
              model: {
                kind: 'give',
                members,
                roles: giveable,
                scopes: [
                  { value: 'organization', label: 'Whole organization' },
                  ...view.lobbies.map((lobby) => ({
                    value: lobby.lobbyId,
                    label: `${lobby.name}${lobby.closed ? ' (closed)' : ''}`,
                  })),
                ],
              },
              context: { ...base, commandId: context.nextId(), intent: 'give' },
            },
            true,
          )
        : null,
    people: view.people.map(person),
    roles: roles.map((role) => ({
      id: roleSlug(role),
      name: role.name,
      href: `${context.basePath}?role=${roleSlug(role)}`,
      selected: role.roleId === chosen?.roleId,
    })),
    role: peopleRoleOf(
      chosen ?? null,
      [
        "Whatever a role allows, anyone connected to a room is handled by that tournament's setting.",
        view.conflictHandling === null
          ? null
          : `At ${view.conflictHandling.name} ${handlingWords[view.conflictHandling.value]}.`,
      ]
        .filter((part): part is string => part !== null)
        .join(' '),
    ),
  };
}
