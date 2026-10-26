import { bindRoundCommandPrincipal } from '@daisy/auth';
import { createRoundRuntime, decideStartHorizon } from '@daisy/debate-engine';
import { ROUND_START_HORIZON_MS } from '../round-finalization/maintenance';
import type { Database, LockedRoundCommandContext } from '@daisy/db';
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
        buildProjection: ({ round, now }) =>
          createRoundRuntime({
            round,
            rules: round.rules,
            participants: round.participants,
            checkpoint: round.checkpoint,
            segments: round.segments,
            nextSegmentId: input.nextSegmentId,
          }).tick(now),
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
          const runtime = createRoundRuntime({
            round: context.round,
            rules: context.round.rules,
            participants: context.round.participants,
            checkpoint: context.round.checkpoint,
            segments: context.round.segments,
            nextSegmentId: input.nextSegmentId,
          });
          try {
            if (
              envelope.command.type === 'start' &&
              decideStartHorizon({
                status: context.round.status,
                launchedAtMs: Date.parse(context.round.launchedAt),
                horizonMs: ROUND_START_HORIZON_MS,
                nowMs: Date.parse(context.now),
              }) === 'abandon'
            )
              throw createAppError('CONFLICT', 'Start horizon has passed');
            return runtime.execute({
              command: { type: envelope.command.type },
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
