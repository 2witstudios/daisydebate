import type { RoundParticipantSeat } from './runtime';
import { z } from 'zod';
import { idSchema } from './primitives';
import type { RoundView } from './round-view';
import type { BetaAccessState } from './beta-access';

const seated = (
  type: 'start_prep' | 'start_speech' | 'yield' | 'interrupt' | 'forfeit',
) => z.strictObject({ type: z.literal(type), participantId: idSchema });
/** Completion belongs to the ballot transaction, never a caller-supplied outcome. */
export const roundCommandEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  expectedVersion: z.int().positive(),
  command: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('start') }),
    seated('start_prep'),
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

export type RoundCommandAuthority = {
  readonly roundId: string;
  readonly hostActorId: string | null;
  /**
   * ADR 0075: the commanding human's own access facts, read under the
   * account fence (null for an AgentRun). The evaluator decides from them;
   * seats stay membership-only so an opponent's Round is independent.
   */
  readonly principalAccess: {
    readonly beta: BetaAccessState | null;
    readonly ageBand: 'under-13' | '13-15' | '16-17' | 'adult' | null;
  } | null;
  readonly participants: readonly (RoundParticipantSeat & {
    readonly kind: 'human' | 'bot';
    readonly eligible: boolean;
  })[];
  readonly agentRun: {
    readonly id: string;
    readonly participantId: string;
    readonly serviceId: string;
    readonly active: boolean;
  } | null;
};
