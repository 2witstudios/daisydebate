import type { LockedRoundCommandContext } from '@daisy/db/rounds';
import { emptyRuntimeCheckpoint } from '@daisy/protocol';
import { caller, launched, now } from '../room-runtime/operations.test-support';

/** The one-on-one Round with a complete human cast, as the store locks it. */
export const seat = launched.participants[0]!;
export const judgeSeatId = 'j'.repeat(24);
const others = [
  {
    id: 'q4n6p8r2t4v6x8z1k3b5c7d9',
    actorId: 'b4n6p8r2t4v6x8z1k3b5c7d9',
    role: 'negative' as const,
    slot: 0,
  },
  {
    id: judgeSeatId,
    actorId: 'g4n6p8r2t4v6x8z1k3b5c7d9',
    role: 'judge' as const,
    slot: 0,
  },
];
export const judgeActorId = others[1]!.actorId;
export const lockedRound: LockedRoundCommandContext = {
  round: {
    ...launched,
    competitionType: 'casual',
    formatId: 'one-on-one',
    formatVersion: 1,
    resolution: launched.topic,
    currentStage: null,
    launchedAt: '2026-10-10T12:00:00.000Z',
    checkpoint: emptyRuntimeCheckpoint,
    participants: [
      { id: seat.id, actorId: seat.actorId, role: seat.role, slot: seat.slot },
      ...others,
    ],
  },
  authority: {
    roundId: launched.id,
    hostActorId: caller.actorId,
    participants: [seat, ...others.map((p) => ({ ...p, label: 'Member' }))].map(
      (p) => ({ ...p, kind: 'human' as const, eligible: true }),
    ),
    agentRun: null,
  },
  now,
};
