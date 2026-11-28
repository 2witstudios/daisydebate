import type { RoundParticipantSeat } from './runtime';
import { z } from 'zod';
import { idSchema } from './primitives';
import type { RoundView } from './round-view';
import type { BetaAccessState } from './beta-access';

const seated = (type: 'forfeit' | 'leave') =>
  z.strictObject({ type: z.literal(type), participantId: idSchema });
/**
 * A floor command names the segment it means (INTX-7): prep and its speech
 * name the segment prepped for, the rest the speech or cross-examination they
 * act in. A press that reaches the Round after that segment changed is
 * refused as stale, never applied to the next one.
 */
const onSegment = (
  type:
    | 'start_prep'
    | 'cancel_prep'
    | 'start_speech'
    | 'yield'
    | 'offer_poi'
    | 'withdraw_poi'
    | 'decline_poi'
    | 'end_poi',
) =>
  z.strictObject({
    type: z.literal(type),
    participantId: idSchema,
    sequence: z.int().min(0),
  });
/** A strike names the turn it means to take, so a stale form conflicts. */
const strikeResolution = z.strictObject({
  type: z.literal('strike_resolution'),
  participantId: idSchema,
  ordinal: z.int().min(0),
  position: z.int().min(0),
});
/** Accepting names the one offer taken, so a withdrawn or lapsed one conflicts. */
const acceptPointOfInformation = z.strictObject({
  type: z.literal('accept_poi'),
  participantId: idSchema,
  sequence: z.int().min(0),
  offererParticipantId: idSchema,
});
/** Completion belongs to the ballot transaction, never a caller-supplied outcome. */
export const roundCommandEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  expectedVersion: z.int().positive(),
  command: z.discriminatedUnion('type', [
    strikeResolution,
    onSegment('start_prep'),
    onSegment('cancel_prep'),
    onSegment('start_speech'),
    onSegment('yield'),
    onSegment('offer_poi'),
    onSegment('withdraw_poi'),
    acceptPointOfInformation,
    onSegment('decline_poi'),
    onSegment('end_poi'),
    seated('forfeit'),
    seated('leave'),
  ]),
});
export type RoundCommandEnvelope = z.infer<typeof roundCommandEnvelopeSchema>;
/** The closed vocabulary a Round command or ballot refusal answers with. */
export const roundRefusalSchema = z.enum([
  'not-found',
  'not-authorized',
  'not-seated',
  'stale-version',
  'command-conflict',
  'illegal-command',
  'freeze-not-ready',
  'ballot-already-submitted',
  'round-decided',
  'attendance-unsettled',
  'strike-conflict',
  'strike-unavailable',
  'not-your-turn',
  'platform-incident',
]);
export type RoundRefusal = z.infer<typeof roundRefusalSchema>;
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
    readonly restricted: boolean;
  } | null;
  readonly participants: readonly (RoundParticipantSeat & {
    readonly eligible: boolean;
  })[];
  readonly agentRun: {
    readonly id: string;
    readonly participantId: string;
    readonly serviceId: string;
    readonly active: boolean;
  } | null;
};
