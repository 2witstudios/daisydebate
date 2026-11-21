import { z } from 'zod';
import { idSchema } from '../primitives';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

/** Announcement records a durable action fact; it never stores or publishes a computed draw. */
const breakCommandSchema = z.strictObject({
  type: z.literal('announce-break'),
  eventId: idSchema,
});
export type BreakCommand = z.infer<typeof breakCommandSchema>;
export const breakCommandEnvelopeSchema =
  lobbyCommandEnvelope(breakCommandSchema);
const breakCommandRefusals = [
  'results-incomplete',
  'break-not-configured',
  'choices-pending',
  'already-announced',
] as const;
export const breakCommandCatalogue = {
  'announce-break': {
    aggregate: 'event',
    gate: ['tournament.results.release'],
    versions: ['results'],
    refusals: breakCommandRefusals,
    history: 'entry',
  },
} as const satisfies LobbyCommandCatalogue<BreakCommand>;
