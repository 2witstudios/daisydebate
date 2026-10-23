import { createAppError } from '@daisy/errors';
import type { BotPublicationScope } from './bot-publication-context';
import { nextEpoch } from './lease-policy';

type Target = Pick<
  BotPublicationScope,
  'roundId' | 'roundParticipantId' | 'segmentId'
>;

/** Bots publish only for a debating seat of an active Round. */
export function requirePublishingSeat(
  round: { readonly status: string },
  seat: { readonly role: string },
): void {
  if (round.status !== 'active' || seat.role === 'judge')
    throw createAppError('AUTHORIZATION');
}

/** A new claim waits for the previous lease to expire, then takes the next epoch. */
export function nextPublicationClaim(
  current:
    | {
        readonly leaseExpiresAt: Date;
        readonly publicationEpoch: number;
      }
    | undefined,
  now: Date,
): number {
  if (current && current.leaseExpiresAt.getTime() > now.getTime())
    throw createAppError('CONFLICT', 'Publication already claimed');
  return nextEpoch(
    current?.publicationEpoch ?? 0,
    'Publication epoch exhausted',
  );
}

/** One run per claim; its own service identity is the only publisher. */
export const publicationClaim = (input: {
  readonly target: Target;
  readonly agentRunId: string;
  readonly epoch: number;
  readonly leaseTokenDigest: string;
  readonly now: Date;
  readonly leaseMs: number;
}) => {
  const serviceId = `agent-run:${input.agentRunId}`;
  const scope: BotPublicationScope = {
    ...input.target,
    agentRunId: input.agentRunId,
    serviceId,
    publicationEpoch: input.epoch,
  };
  return {
    scope,
    configuration: {
      roundId: input.target.roundId,
      roundParticipantId: input.target.roundParticipantId,
      segmentId: input.target.segmentId,
      serviceId,
      publicationEpoch: input.epoch,
    },
    row: {
      ...scope,
      leaseTokenDigest: input.leaseTokenDigest,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
    },
  };
};
