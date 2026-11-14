import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  lobbyCommandEnvelope,
  type LobbyCommandCatalogue,
  type LobbyCommandDefinition,
} from './command';
import { videoAudienceCaps } from './vocabulary';

/**
 * The guardian commands (TAB-5.9). A guardian link is a relationship
 * between two people, never a role: a parent's is made directly, a coach's
 * through a school by whoever manages its roster.
 */

/** How a link is made: a parent's directly, a coach's through a school. */
const linkThrough = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('direct') }),
  z.strictObject({ kind: z.literal('school'), organizationId: idSchema }),
]);

const onLink = { guardianLinkId: idSchema } as const;

export const guardianCommandSchema = z.discriminatedUnion('type', [
  z
    .strictObject({
      type: z.literal('create-guardian-link'),
      guardianUserId: idSchema,
      wardUserId: idSchema,
      through: linkThrough,
    })
    .refine((link) => link.guardianUserId !== link.wardUserId, {
      message: 'A link joins two people.',
      path: ['wardUserId'],
    }),
  /** The guardian consents under the notice version they were shown. */
  z.strictObject({
    type: z.literal('consent-guardian-link'),
    ...onLink,
    noticeVersion: z.int().positive(),
  }),
  /** A second parent for the same ward, pending their own consent. */
  z.strictObject({
    type: z.literal('add-guardian'),
    ...onLink,
    guardianUserId: idSchema,
  }),
  z
    .strictObject({
      type: z.literal('set-restriction'),
      ...onLink,
      limitsLobbies: z.boolean(),
      allowedLobbyIds: z.array(idSchema),
      videoCap: z.enum(videoAudienceCaps),
    })
    .refine(
      (restriction) =>
        new Set(restriction.allowedLobbyIds).size ===
        restriction.allowedLobbyIds.length,
      { message: 'Each lobby is allowed once.', path: ['allowedLobbyIds'] },
    )
    .refine(
      (restriction) =>
        restriction.limitsLobbies || restriction.allowedLobbyIds.length === 0,
      {
        message: 'Lobbies are listed only when the restriction limits them.',
        path: ['allowedLobbyIds'],
      },
    ),
  z.strictObject({ type: z.literal('end-guardian-link'), ...onLink }),
]);
export type GuardianCommand = z.infer<typeof guardianCommandSchema>;
export const guardianCommandEnvelopeSchema = lobbyCommandEnvelope(
  guardianCommandSchema,
);

/** Every refusal a guardian command can give, beside the shared ones. */
export const guardianRefusals = [
  'ward-not-minor',
  'guardian-not-adult',
  'guardian-not-member',
  'link-exists',
  'link-not-pending',
  'link-not-active',
  'link-ended',
  'notice-changed',
  'not-a-parent',
  'lobby-unavailable',
  'last-guardian',
] as const;
export type GuardianRefusal = (typeof guardianRefusals)[number];
export const guardianRefusalSchema = z.enum(guardianRefusals);

const command = (
  definition: Omit<
    LobbyCommandDefinition<GuardianRefusal>,
    'aggregate' | 'history'
  >,
): LobbyCommandDefinition<GuardianRefusal> => ({
  aggregate: 'guardian_link',
  history: 'entry',
  ...definition,
});

export const guardianCommandCatalogue = {
  'create-guardian-link': command({
    gate: ['guardian.link.create'],
    versions: [],
    refusals: [
      'ward-not-minor',
      'guardian-not-adult',
      'guardian-not-member',
      'link-exists',
    ],
  }),
  'consent-guardian-link': command({
    gate: ['guardian.link.manage'],
    versions: ['guardianLink'],
    refusals: ['link-not-pending', 'notice-changed'],
  }),
  'add-guardian': command({
    gate: ['guardian.link.manage'],
    versions: ['guardianLink'],
    refusals: [
      'link-not-active',
      'not-a-parent',
      'guardian-not-adult',
      'link-exists',
    ],
  }),
  'set-restriction': command({
    gate: ['guardian.link.manage'],
    versions: ['guardianLink'],
    refusals: ['link-not-active', 'not-a-parent', 'lobby-unavailable'],
  }),
  'end-guardian-link': command({
    gate: ['guardian.link.manage'],
    versions: ['guardianLink'],
    refusals: ['link-ended', 'last-guardian'],
  }),
} as const satisfies LobbyCommandCatalogue<GuardianCommand>;
