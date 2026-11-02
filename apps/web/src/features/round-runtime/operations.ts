import { bindRoundCommandPrincipal } from '@daisy/auth';
import {
  createRoundRuntime,
  forfeitInOpening,
  strikeInOpening,
} from '@daisy/debate-engine';
import { roundTickProjection } from '../round-finalization/operations';
import type { Database } from '@daisy/db';
import type { LockedRoundCommandContext } from '@daisy/db/rounds';
import { createAppError, isAppError } from '@daisy/errors';
import {
  roundCommandEnvelopeSchema,
  type RoundCommandEnvelope,
  type RoundCommandPrincipal,
} from '@daisy/protocol';

/** One shared command operation for session callers and seat-scoped AgentRuns. */
export function createRoundRuntimeOperations(input: {
  readonly store: Pick<Database, 'executeRoundCommand' | 'executeRoundTick'>;
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
        if (!result.ok) throw createAppError('AUTHORIZATION', result.refusal);
        return result;
      };
      return input.store.executeRoundCommand({
        roundId,
        principal,
        envelope,
        payloadDigest: new Bun.CryptoHasher('sha3-256')
          .update(JSON.stringify(envelope))
          .digest('hex'),
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
              command: { type: command.type },
              actorId: bound.actorId,
              now: context.now,
            });
          } catch (error) {
            if (
              isAppError(error) &&
              (error.code === 'CONFLICT' || error.code === 'INVARIANT')
            )
              throw createAppError('CONFLICT', 'illegal-command', error);
            throw error;
          }
        },
      });
    },
  };
}
