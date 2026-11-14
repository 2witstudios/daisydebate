import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  lobbyCommandEnvelope,
  type LobbyCommandCatalogue,
  type LobbyCommandDefinition,
} from './command';
import { organizationKinds } from './vocabulary';

/**
 * The organization and grant commands (TAB-5.9). A membership grants
 * nothing; authority comes only from a grant of one of Daisy's preset roles
 * at one scope. No command here, or anywhere, creates or edits a role.
 */

const organizationName = z.string().trim().min(1).max(120);
/** An organization's address: 3 to 40 lowercase letters, digits and inner hyphens. */
const organizationHandle = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);

/** Where a grant gives its role: the organization, or one of its lobbies. */
const grantScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('organization') }),
  z.strictObject({ kind: z.literal('lobby'), lobbyId: idSchema }),
]);

const inOrganization = { organizationId: idSchema } as const;

export const organizationCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('create-organization'),
    kind: z.enum(organizationKinds),
    name: organizationName,
    handle: organizationHandle,
  }),
  z.strictObject({
    type: z.literal('update-organization'),
    ...inOrganization,
    name: organizationName,
  }),
  z.strictObject({
    type: z.literal('invite-member'),
    ...inOrganization,
    userId: idSchema,
  }),
  /** The sender answers their own invitation. */
  z.strictObject({ type: z.literal('accept-membership'), ...inOrganization }),
  z.strictObject({ type: z.literal('decline-membership'), ...inOrganization }),
  /** The member leaves, or someone who manages roles ends it. */
  z.strictObject({
    type: z.literal('end-membership'),
    ...inOrganization,
    userId: idSchema,
  }),
  z.strictObject({
    type: z.literal('give-grant'),
    ...inOrganization,
    userId: idSchema,
    roleId: idSchema,
    scope: grantScope,
    expiresAt: z.iso.datetime().nullable(),
  }),
  z.strictObject({
    type: z.literal('remove-grant'),
    ...inOrganization,
    grantId: idSchema,
  }),
  z.strictObject({
    type: z.literal('transfer-ownership'),
    ...inOrganization,
    userId: idSchema,
  }),
]);
export type OrganizationCommand = z.infer<typeof organizationCommandSchema>;
export const organizationCommandEnvelopeSchema = lobbyCommandEnvelope(
  organizationCommandSchema,
);

/** Every refusal an organization or grant command can give, beside the shared ones. */
export const organizationRefusals = [
  'handle-taken',
  'already-member',
  'invitation-closed',
  'last-owner',
  'outranked',
  'permission-not-held',
  'scope-not-covered',
  'role-not-below',
  'role-unavailable',
  'not-a-member',
  'age-band',
  'expiry-passed',
  'already-granted',
  'grant-ended',
] as const;
export type OrganizationRefusal = (typeof organizationRefusals)[number];
export const organizationRefusalSchema = z.enum(organizationRefusals);

const command = (
  definition: Omit<
    LobbyCommandDefinition<OrganizationRefusal>,
    'aggregate' | 'history'
  >,
): LobbyCommandDefinition<OrganizationRefusal> => ({
  aggregate: 'organization',
  history: 'entry',
  ...definition,
});

export const organizationCommandCatalogue = {
  'create-organization': command({
    gate: ['organization.create'],
    versions: [],
    refusals: ['handle-taken'],
  }),
  'update-organization': command({
    gate: ['organization.manage'],
    versions: ['organization'],
    refusals: [],
  }),
  'invite-member': command({
    gate: ['organization.roles.manage', 'school.roster.manage'],
    versions: ['organization'],
    refusals: ['already-member'],
  }),
  'accept-membership': command({
    gate: ['organization.membership.respond'],
    versions: [],
    refusals: ['invitation-closed'],
  }),
  'decline-membership': command({
    gate: ['organization.membership.respond'],
    versions: [],
    refusals: ['invitation-closed'],
  }),
  'end-membership': command({
    gate: ['organization.membership.leave', 'organization.roles.manage'],
    versions: [],
    refusals: ['not-a-member', 'last-owner', 'outranked'],
  }),
  'give-grant': command({
    gate: ['organization.roles.manage'],
    versions: ['organization'],
    refusals: [
      'role-unavailable',
      'scope-not-covered',
      'permission-not-held',
      'role-not-below',
      'not-a-member',
      'age-band',
      'expiry-passed',
      'already-granted',
    ],
  }),
  'remove-grant': command({
    gate: ['organization.roles.manage'],
    versions: [],
    refusals: ['grant-ended', 'outranked'],
  }),
  'transfer-ownership': command({
    gate: ['organization.owner.transfer'],
    versions: ['organization'],
    refusals: ['not-a-member'],
  }),
} as const satisfies LobbyCommandCatalogue<OrganizationCommand>;
