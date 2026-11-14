import { z } from 'zod';
import { idSchema } from '../primitives';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

/**
 * Sanction commands (TAB-5.12): a league sanctions one event of a lobby
 * against one of its templates, once. The sanction check decides; its answer
 * is yes or no, so `template-mismatch` carries no comparison.
 */

export const requestSanctionCommandSchema = z.strictObject({
  type: z.literal('request-sanction'),
  leagueId: idSchema,
  eventId: idSchema,
  templateId: idSchema,
  seasonId: idSchema,
});

export const approveSanctionCommandSchema = z.strictObject({
  type: z.literal('approve-sanction'),
  sanctionId: idSchema,
});

export const declineSanctionCommandSchema = z.strictObject({
  type: z.literal('decline-sanction'),
  sanctionId: idSchema,
});

export const withdrawSanctionCommandSchema = z.strictObject({
  type: z.literal('withdraw-sanction'),
  sanctionId: idSchema,
  reason: z.string().trim().min(1).max(2000),
});

export const sanctionCommandSchema = z.discriminatedUnion('type', [
  requestSanctionCommandSchema,
  approveSanctionCommandSchema,
  declineSanctionCommandSchema,
  withdrawSanctionCommandSchema,
]);
export type SanctionCommand = z.infer<typeof sanctionCommandSchema>;
export const sanctionCommandEnvelopeSchema = lobbyCommandEnvelope(
  sanctionCommandSchema,
);

export const sanctionCommandRefusals = [
  'already-requested',
  'template-foreign',
  'season-foreign',
  'template-mismatch',
  'sanction-settled',
  'results-certified',
] as const;
export type SanctionCommandRefusal = (typeof sanctionCommandRefusals)[number];
export const sanctionCommandRefusalSchema = z.enum(sanctionCommandRefusals);

export const sanctionCommandCatalogue = {
  'request-sanction': {
    aggregate: 'sanction',
    gate: ['lobby.setup.manage'],
    versions: [],
    refusals: [
      'already-requested',
      'template-foreign',
      'season-foreign',
      'template-mismatch',
    ],
    history: 'entry',
  },
  'approve-sanction': {
    aggregate: 'sanction',
    gate: ['organization.manage'],
    versions: ['sanction'],
    refusals: ['sanction-settled', 'template-mismatch'],
    history: 'entry',
  },
  'decline-sanction': {
    aggregate: 'sanction',
    gate: ['organization.manage'],
    versions: ['sanction'],
    refusals: ['sanction-settled'],
    history: 'entry',
  },
  'withdraw-sanction': {
    aggregate: 'sanction',
    gate: ['lobby.setup.manage', 'organization.manage'],
    versions: ['sanction'],
    refusals: ['sanction-settled', 'results-certified'],
    history: 'entry',
  },
} as const satisfies LobbyCommandCatalogue<SanctionCommand>;
