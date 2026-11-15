import { daisyBallotSource } from '@daisy/protocol';
import type { LockedRoundCommandContext } from '@daisy/db/rounds';
import {
  daisyWinnerBallot,
  emptyRuntimeCheckpointFor,
  panelRuleFor,
  twoSides,
} from '@daisy/protocol';
import { caller, now } from '../room-runtime/operations.test-support';
import { launched } from './round.test-support';

/** The one-on-one Round with a complete human cast, as the store locks it. */
export const seat = launched.participants[0]!;
export const judgeSeatId = 'j'.repeat(24);
const others = [
  {
    id: 'q4n6p8r2t4v6x8z1k3b5c7d9',
    actorId: 'b4n6p8r2t4v6x8z1k3b5c7d9',
    seat: { kind: 'side', side: 'negative', slot: 0 } as const,
  },
  {
    id: judgeSeatId,
    actorId: 'g4n6p8r2t4v6x8z1k3b5c7d9',
    seat: { kind: 'judge', slot: 0 } as const,
  },
];
export const judgeActorId = others[1]!.actorId;
export const lockedRound: LockedRoundCommandContext = {
  round: {
    ...launched,
    opening: null,
    competitionType: 'casual',
    formatId: 'one-on-one',
    formatVersion: 1,
    resolution: launched.topic,
    currentStage: null,
    judging: {
      source: daisyBallotSource(daisyWinnerBallot),
      ballot: daisyWinnerBallot,
      panel: panelRuleFor(daisyWinnerBallot),
    },
    launchedAt: '2026-10-10T12:00:00.000Z',
    checkpoint: emptyRuntimeCheckpointFor({ sides: twoSides }),
    participants: [
      { id: seat.id, actorId: seat.actorId, seat: seat.seat },
      ...others,
    ],
  },
  authority: {
    roundId: launched.id,
    // An admitted participant (ADR 0075).
    principalAccess: { beta: 'approved', ageBand: 'adult', restricted: false },
    hostActorId: caller.actorId,
    participants: [seat, ...others.map((p) => ({ ...p, label: 'Member' }))].map(
      (p) => ({ ...p, kind: 'human' as const, eligible: true }),
    ),
    agentRun: null,
  },
  now,
};
