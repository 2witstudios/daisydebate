import { z } from 'zod';
import { idSchema } from '../primitives';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

const tournamentSponsorshipCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('propose-tournament-sponsorship'),
    lobbyId: idSchema,
    sponsorUserId: idSchema,
  }),
  z.strictObject({
    type: z.literal('accept-tournament-sponsorship'),
    lobbyId: idSchema,
    proposalId: idSchema,
    hostingVersionId: idSchema,
  }),
  z.strictObject({
    type: z.literal('revoke-tournament-sponsorship'),
    lobbyId: idSchema,
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type TournamentSponsorshipCommand = z.infer<
  typeof tournamentSponsorshipCommandSchema
>;
export const tournamentSponsorshipCommandEnvelopeSchema = lobbyCommandEnvelope(
  tournamentSponsorshipCommandSchema,
);
export const tournamentSponsorshipCommandCatalogue = {
  'propose-tournament-sponsorship': {
    aggregate: 'lobby',
    gate: ['lobby.setup.manage'],
    versions: ['lobby'],
    refusals: ['sponsorship-unavailable'],
    history: 'entry',
  },
  'accept-tournament-sponsorship': {
    aggregate: 'lobby',
    gate: ['tournament.sponsorship.consent'],
    versions: ['lobby'],
    refusals: ['sponsorship-unavailable', 'hosting-coverage-required'],
    history: 'entry',
  },
  'revoke-tournament-sponsorship': {
    aggregate: 'lobby',
    gate: ['lobby.setup.manage', 'tournament.sponsorship.withdraw'],
    versions: ['lobby'],
    refusals: ['sponsorship-unavailable'],
    history: 'entry',
  },
} as const satisfies LobbyCommandCatalogue<TournamentSponsorshipCommand>;
