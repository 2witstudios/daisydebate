import type { RoomAssemblyState } from '@daisy/protocol';

/**
 * Owner decision 2026-11-02 (WATCH-16): seating an AI judge is free on a
 * ranked Round, as part of the signed content waiver, and premium on a casual
 * one. The gate is on seating, never on reading a ballot that exists.
 */
export const aiJudgeSeatAdmitted = (
  room: Pick<RoomAssemblyState, 'competitionType'>,
  hostMaySeatCasualAiJudge: boolean,
): boolean => room.competitionType === 'ranked' || hostMaySeatCasualAiJudge;

/** The cast holds an AI judge seat its host could not seat today. */
export const castHoldsUnadmittedAiJudge = (
  room: Pick<RoomAssemblyState, 'competitionType' | 'participants'>,
  hostMaySeatCasualAiJudge: boolean,
): boolean =>
  !aiJudgeSeatAdmitted(room, hostMaySeatCasualAiJudge) &&
  room.participants.some((p) => p.kind === 'bot' && p.role === 'judge');
