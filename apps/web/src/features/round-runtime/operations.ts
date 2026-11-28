import type { RoundStore } from '@daisy/db/stores/rounds';
import { commandDigest } from '@daisy/digest';
import { bindRoundCommandPrincipal } from '@daisy/auth';
import {
  createRoundRuntime,
  forfeitInOpening,
  strikeInOpening,
} from '@daisy/debate-engine';
import { roundTickProjection } from '../round-finalization/operations';
import type { LockedRoundCommandContext } from '@daisy/db/rounds';
import { createAppError, isAppError, createRefusal } from '@daisy/errors';
import type { RoundCommand } from '@daisy/protocol/runtime';
import {
  roundCommandEnvelopeSchema,
  type RoundCommandEnvelope,
  type RoundCommandPrincipal,
} from '@daisy/protocol/round-command';

/** One shared command operation for session callers and seat-scoped AgentRuns. */
export function createRoundRuntimeOperations(input: {
  readonly store: Pick<RoundStore, 'executeRoundCommand' | 'executeRoundTick'>;
  readonly nextSegmentId: () => string;
}) {
  return {
    tick: (roundId: string) =>
      input.store.executeRoundTick({
        roundId,
        runsOpening: true,
        buildProjection: roundTickProjection(input.nextSegmentId),
      }),
    async command(
      principal: RoundCommandPrincipal,
      roundId: string,
      raw: RoundCommandEnvelope,
    ) {
      const parsed = roundCommandEnvelopeSchema.safeParse(raw);
      if (!parsed.success) throw createAppError('VALIDATION');
      const envelope = parsed.data;
      const bind = ({ authority }: LockedRoundCommandContext) => {
        const result = bindRoundCommandPrincipal({
          principal,
          command: envelope.command,
          authority,
        });
        if (!result.ok) throw createRefusal('AUTHORIZATION', result.refusal);
        return result;
      };
      return input.store.executeRoundCommand({
        roundId,
        principal,
        envelope,
        payloadDigest: commandDigest(envelope),
        authorize: (context) => {
          bind(context);
        },
        buildProjection: (context) => {
          const bound = bind(context);
          const { round } = context;
          const hydrated = {
            round,
            rules: round.rules,
            participants: round.participants,
            checkpoint: round.checkpoint,
            segments: round.segments,
            nextSegmentId: input.nextSegmentId,
          };
          const { command } = envelope;
          try {
            if (command.type === 'strike_resolution') {
              if (!round.opening || bound.actorId === null)
                throw createAppError('CONFLICT', 'No strike is open');
              return strikeInOpening({
                ...hydrated,
                opening: round.opening.state,
                seed: round.opening.seed,
                now: context.now,
                seats: context.authority.participants,
                strike: {
                  actorId: bound.actorId,
                  commandId: envelope.commandId,
                  ordinal: command.ordinal,
                  position: command.position,
                },
              });
            }
            if (
              round.opening &&
              command.type === 'forfeit' &&
              bound.actorId !== null
            )
              return forfeitInOpening({
                ...hydrated,
                opening: round.opening.state,
                seed: round.opening.seed,
                now: context.now,
                actorId: bound.actorId,
              });
            return createRoundRuntime(hydrated).execute({
              command: engineCommandOf(command),
              actorId: bound.actorId,
              now: context.now,
            });
          } catch (error) {
            if (
              isAppError(error) &&
              (error.code === 'CONFLICT' || error.code === 'INVARIANT')
            )
              throw createRefusal(
                'CONFLICT',
                'illegal-command',
                undefined,
                error,
              );
            throw error;
          }
        },
      });
    },
  };
}

/**
 * The engine's command from a seated envelope's: the seat is the principal's,
 * already bound, and everything else the press named travels unchanged, so a
 * stale segment is the engine's to refuse (INTX-7).
 */
function engineCommandOf(
  command: Exclude<
    RoundCommandEnvelope['command'],
    { readonly type: 'strike_resolution' }
  >,
): RoundCommand {
  switch (command.type) {
    case 'forfeit':
    case 'leave':
      return { type: command.type };
    case 'accept_poi':
      return {
        type: command.type,
        sequence: command.sequence,
        offererParticipantId: command.offererParticipantId,
      };
    case 'start_prep':
    case 'cancel_prep':
    case 'start_speech':
    case 'yield':
    case 'offer_poi':
    case 'withdraw_poi':
    case 'decline_poi':
    case 'end_poi':
      return { type: command.type, sequence: command.sequence };
  }
}
