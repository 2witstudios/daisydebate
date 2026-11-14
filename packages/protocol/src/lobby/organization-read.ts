import { z } from 'zod';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import {
  conflictBases,
  conflictHandlings,
  grantScopeKinds,
  lobbyKinds,
  membershipStatuses,
  organizationKinds,
  permissions,
  stageKinds,
  tournamentStatuses,
} from './vocabulary';

const name = z.string().trim().min(1).max(200);
const handle = z.string().trim().min(1).max(64);
const count = z.int().min(0);
const instant = z.iso.datetime();

const organizationRef = z.strictObject({ organizationId: idSchema, name });
const lobbyRef = z.strictObject({ lobbyId: idSchema, handle, name });

/** Where the viewer hosts: owning it, or through a grant of a named role. */
const hostPosition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owner') }),
  z.strictObject({ kind: z.literal('grant'), roleName: name }),
]);

/** How a tournament's results reached the league that sanctioned it. */
const tournamentProgress = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('draft') }),
  z.strictObject({
    status: z.literal('open'),
    /** Setup items the host has still to finish. */
    setupOpen: count,
    entryCount: count,
  }),
  z.strictObject({
    status: z.literal('running'),
    round: z.strictObject({ current: z.int().min(1), of: z.int().min(1) }),
    /** Things in the tournament waiting on the viewer. */
    attention: count,
  }),
  z.strictObject({
    status: z.literal('completed'),
    certifiedAt: instant.nullable(),
    /** Whether a sanctioning league counts its certified results. */
    countedByLeague: z.boolean(),
  }),
  z.strictObject({ status: z.literal('cancelled') }),
]) satisfies z.ZodType<{ status: (typeof tournamentStatuses)[number] }>;

/** The shape of a tournament a viewer runs themselves, without a league. */
const ownTournamentShape = z.strictObject({
  approval: z.enum(['automatic', 'host']),
  cap: z.int().min(1).nullable(),
  stages: z.array(z.enum(stageKinds)).min(1),
  seeding: z.enum(['standings', 'rating']),
});

export const hostLobbySchema = z.strictObject({
  lobbyId: idSchema,
  handle,
  name,
  kind: z.enum(lobbyKinds),
  /** The organization that owns it, or null when the viewer does. */
  owner: organizationRef.nullable(),
  position: hostPosition,
  startsAt: instant.nullable(),
  progress: tournamentProgress.nullable(),
  shape: ownTournamentShape.nullable(),
});
export type HostLobby = z.infer<typeof hostLobbySchema>;

export const hostOrganizationSchema = z.strictObject({
  organizationId: idSchema,
  handle,
  name,
  kind: z.enum(organizationKinds),
  position: hostPosition,
  schoolCount: count,
  memberCount: count,
  sanctionRequestsWaiting: count,
});
export type HostOrganization = z.infer<typeof hostOrganizationSchema>;

/**
 * Host home: every organization and lobby where a `*.host.read` allows the
 * viewer, and whether they may create a tournament.
 */
export const hostHomeViewSchema = z.strictObject({
  organizations: z.array(hostOrganizationSchema),
  lobbies: z.array(hostLobbySchema),
  capabilities: z.strictObject({ createLobby: z.boolean() }),
});
export type HostHomeView = z.infer<typeof hostHomeViewSchema>;

const publicProfile = {
  organizationId: idSchema,
  handle,
  name,
  kind: z.enum(organizationKinds),
  standingLobby: lobbyRef.nullable(),
};
/**
 * One organization. Everyone `organization.read` allows sees the public
 * profile; the counts a host works from only with `organization.host.read`.
 */
export const organizationViewSchema = z.discriminatedUnion('audience', [
  z.strictObject({ audience: z.literal('public'), ...publicProfile }),
  z.strictObject({
    audience: z.literal('host'),
    ...publicProfile,
    schoolCount: count,
    memberCount: count,
    /** Rooms open in the standing lobby now. */
    openRoomCount: count,
    /** Members the organization's own ladder rates. */
    ratedCount: count,
    capabilities: z.strictObject({ manage: z.boolean() }),
  }),
]);
export type OrganizationView = z.infer<typeof organizationViewSchema>;

const grantScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('organization') }),
  z.strictObject({ kind: z.literal('lobby'), lobbyId: idSchema, name }),
]) satisfies z.ZodType<{ kind: (typeof grantScopeKinds)[number] }>;

export const personGrantSchema = z.strictObject({
  grantId: idSchema,
  roleId: idSchema,
  scope: grantScope,
  expiresAt: instant.nullable(),
});

/** A connection the evaluator has recorded between a person and this lobby's Rooms. */
export const personConflictSchema = z.strictObject({
  basis: z.enum(conflictBases),
  /** The school the connection runs through, for `school_entry`. */
  school: z.strictObject({ organizationId: idSchema, name }).nullable(),
  entryCount: count,
});

export const organizationPersonSchema = z.strictObject({
  userId: idSchema,
  name,
  owner: z.boolean(),
  membership: z.enum(membershipStatuses),
  grants: z.array(personGrantSchema),
  conflicts: z.array(personConflictSchema),
  /** Rule 5: whether the viewer may end this person's grants. Never the owner. */
  removable: z.boolean(),
});
export type OrganizationPerson = z.infer<typeof organizationPersonSchema>;

export const organizationRoleSchema = z.strictObject({
  roleId: idSchema,
  name,
  rank: z.int().min(0),
  preset: z.boolean(),
  permissions: z.array(z.enum(permissions)),
});
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/**
 * An organization's people: members with their grants and recorded
 * conflicts, the preset roles, and how the lobby asked about handles a
 * connected person.
 */
export const organizationPeopleViewSchema = z
  .strictObject({
    organizationId: idSchema,
    name,
    people: z.array(organizationPersonSchema),
    roles: z.array(organizationRoleSchema),
    conflictHandling: z
      .strictObject({
        lobbyId: idSchema,
        name,
        value: z.enum(conflictHandlings),
      })
      .nullable(),
    capabilities: z.strictObject({ give: z.boolean() }),
  })
  .refine(
    (view) =>
      view.people.every((person) => !(person.owner && person.removable)),
    { message: 'The owner is never removable.', path: ['people'] },
  );
export type OrganizationPeopleView = z.infer<
  typeof organizationPeopleViewSchema
>;

export const organizationReadCatalogue = {
  HostHomeView: { gate: 'signed-in' },
  OrganizationView: { gate: ['organization.read'] },
  OrganizationPeopleView: { gate: ['organization.host.read'] },
} as const satisfies LobbyReadCatalogue<
  'HostHomeView' | 'OrganizationView' | 'OrganizationPeopleView'
>;
