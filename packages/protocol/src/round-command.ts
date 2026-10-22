import { z } from 'zod';
import { idSchema } from './primitives';
import type { RoundView } from './round-view';

const seated = (
  type:
    | 'start_prep'
    | 'end_prep'
    | 'start_speech'
    | 'yield'
    | 'interrupt'
    | 'forfeit',
) => z.strictObject({ type: z.literal(type), participantId: idSchema });
/** Completion belongs to the ballot transaction, never a caller-supplied outcome. */
export const roundCommandEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  expectedVersion: z.int().positive(),
  command: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('start') }),
    seated('start_prep'),
    seated('end_prep'),
    seated('start_speech'),
    seated('yield'),
    seated('interrupt'),
    seated('forfeit'),
  ]),
});
export type RoundCommandEnvelope = z.infer<typeof roundCommandEnvelopeSchema>;
export type RoundRefusal =
  | 'not-found'
  | 'not-authorized'
  | 'not-seated'
  | 'stale-version'
  | 'command-conflict'
  | 'illegal-command';
export type RoundCommandReceipt = {
  readonly commandId: string;
  readonly roundId: string;
  readonly resultingVersion: number;
  readonly replayed: boolean;
};
/** A replay acknowledges the original write, paired with a fresh viewer projection. */
export type RoundCommandResponse = {
  readonly receipt: RoundCommandReceipt;
  readonly view: RoundView;
};
/** Constructed at authenticated server edges; never parsed from a command body. */
export type RoundCommandPrincipal =
  | { readonly kind: 'human'; readonly actorId: string }
  | {
      readonly kind: 'agent';
      readonly serviceId: string;
      readonly agentRunId: string;
      readonly roundId: string;
      readonly participantId: string;
    };
