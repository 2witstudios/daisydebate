import type { RoomAssemblyState, RoomConsent, RoomView } from '@daisy/protocol';

import {
  assemblyOpen,
  complete,
  prepFinished,
  startBlocker,
} from './room-assembly-facts';
const participantReady = (
  p: Pick<
    RoomAssemblyState['participants'][number],
    'kind' | 'eligible' | 'actorId'
  >,
  consent: RoomConsent,
): 'ready' | 'not-ready' | 'unavailable' => {
  if (!consent.available) return 'unavailable';
  const ready =
    p.kind === 'bot' ? p.eligible : consent.readyActorIds.includes(p.actorId);
  return ready ? 'ready' : 'not-ready';
};
/**
 * The human judges this viewer may not name (DEC-98, DEC-174): every one,
 * unless the viewer is that judge or the host who seats them.
 */
const hiddenJudges = (room: RoomAssemblyState, actorId: string) =>
  new Set(
    room.hostActorId === actorId
      ? []
      : room.participants
          .filter(
            (p) =>
              p.role === 'judge' && p.kind === 'human' && p.actorId !== actorId,
          )
          .map((p) => p.actorId),
  );

/** Server projection: consumers never infer startability or consent from local device state. */
export function projectRoom(
  room: RoomAssemblyState,
  actorId: string,
  consent: RoomConsent,
  now: string,
): RoomView {
  const blocker = startBlocker(room, consent, now);
  const hidden = hiddenJudges(room, actorId);
  const { prepStartedAt: _anchor, prepRemainingMs: _remaining, ...rest } = room;
  void _anchor;
  void _remaining;
  return {
    // When the host occupies a judge seat this viewer may not name, the host
    // identity is that judge's identity and is redacted with it (DEC-174).
    ...(hidden.has(room.hostActorId)
      ? { ...rest, hostActorId: null, hostLabel: null }
      : rest),
    participants: room.participants.map(
      ({ consentCommandId: _fence, ...p }) => {
        const state = {
          needsReady: p.kind === 'human',
          ready: participantReady(p, consent),
          eligible: p.eligible,
        };
        return hidden.has(p.actorId)
          ? {
              role: 'judge' as const,
              kind: 'human' as const,
              slot: p.slot,
              anonymous: true as const,
              ...state,
            }
          : { ...p, ...state };
      },
    ),
    readiness: {
      available: consent.available,
      version: room.version,
      readyActorIds: consent.readyActorIds.filter((id) => !hidden.has(id)),
    },
    prep: prepView(room, now),
    capabilities: roomCapabilities(room, actorId, blocker, now),
    startRefusal: blocker,
    botAdmission: null,
  };
}

const prepView = (room: RoomAssemblyState, now: string): RoomView['prep'] => ({
  startedAt: room.prepStartedAt,
  remainingMs:
    room.prepStartedAt !== null && room.prepRemainingMs !== null
      ? Math.max(
          0,
          room.prepRemainingMs -
            (Date.parse(now) - Date.parse(room.prepStartedAt)),
        )
      : room.prepRemainingMs,
  finished: prepFinished(room, now),
});
const prepCapabilities = (room: RoomAssemblyState, now: string) => ({
  canStartPrep:
    complete(room) &&
    room.executionPlan.preRoundPrep.enabled &&
    room.prepStartedAt === null,
  canFinishPrep:
    room.executionPlan.preRoundPrep.enabled &&
    room.prepStartedAt !== null &&
    prepFinished(room, now),
});
const roomCapabilities = (
  room: RoomAssemblyState,
  actorId: string,
  blocker: RoomView['startRefusal'],
  now: string,
): RoomView['capabilities'] => {
  const host = room.hostActorId === actorId;
  const open = assemblyOpen(room);
  const manage = host && open;
  const editable = open && room.prepStartedAt === null;
  const own = room.participants.find((p) => p.actorId === actorId);
  const prep = prepCapabilities(room, now);
  return {
    host,
    canEdit: manage && editable && room.competitionType !== 'ranked',
    canClaimSeat: editable,
    canReady: canReady(open, own),
    canStartPrep: manage && prep.canStartPrep,
    canFinishPrep: manage && prep.canFinishPrep,
    canStart: host && blocker === null,
  };
};
const canReady = (
  open: boolean,
  own: RoomAssemblyState['participants'][number] | undefined,
) => open && own?.kind === 'human' && own.eligible;
