import type { Permission } from '@daisy/protocol/lobby';
import type { People } from './people';

/** The permissions the people page lists, in its order, as it words them. */
const permissionWords: readonly (readonly [Permission, string])[] = [
  ['tournament.draw.edit', 'Change a draft draw'],
  [
    'tournament.rooms.officiate',
    'Run rooms: reseat, replace a judge, restart, forfeit',
  ],
  ['tournament.results.enter', 'Enter and correct results'],
  ['tournament.ballots.read_unreleased', 'See ballots before release'],
  ['tournament.entries.manage', 'Manage entries and judges'],
  ['lobby.announce', 'Message participants'],
  ['tournament.draw.publish', 'Publish a draw'],
  ['tournament.results.release', 'Release and certify results'],
  ['tournament.resolutions.read_unreleased', 'See resolutions before release'],
  ['lobby.setup.manage', 'Change tournament setup'],
  ['organization.roles.manage', 'Manage roles and people'],
  ['organization.manage', 'Manage the league'],
];

export const peopleRoleOf = (
  role: {
    readonly name: string;
    readonly preset: boolean;
    readonly permissions: readonly Permission[];
  } | null,
  conflictRule: string,
): People['role'] => {
  const allowed = new Set(role?.permissions ?? []);
  return {
    name: role?.name ?? '',
    preset: role?.preset ?? false,
    permissions: permissionWords.map(([permission, label]) => ({
      label,
      allowed: allowed.has(permission),
    })),
    conflictRule,
  };
};

/** A role keeps the same address and selection rules on each People screen. */
export const peopleRoleSlug = (role: { readonly name: string }) =>
  role.name.trim().toLowerCase().replaceAll(/\s+/g, '-');
export const peopleRoleSelection = <
  Role extends {
    readonly roleId: string;
    readonly name: string;
    readonly rank: number;
    readonly preset: boolean;
  },
>(
  available: readonly Role[],
  held: readonly string[],
  requested: string | null,
  presetsOnly = true,
) => {
  const roles = available
    .filter((role) => !presetsOnly || role.preset)
    .sort((a, b) => a.rank - b.rank);
  const count = (role: Role) => held.filter((id) => id === role.roleId).length;
  const chosen =
    roles.find((role) => peopleRoleSlug(role) === requested) ??
    [...available].sort((a, b) => count(b) - count(a) || a.rank - b.rank)[0];
  return { roles, chosen };
};
