import type {
  ResolutionDrawView,
  RoomAssemblyState,
  RoomConsent,
  RoomView,
} from '@daisy/protocol';
import { freezeRoomConfig, freezeRoomExecutionPlan } from '@daisy/protocol';
import {
  mayStrike,
  preRoundBegun,
  preRoundPhase,
  type PreRoundPhase,
} from './pre-round-phase';
import { settleRoom, survivorOf } from './resolution-draw';

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

/**
 * Whether this viewer may not name the host: a host seated as a human judge
 * shares that judge's anonymity (DEC-174), except with themselves. Room reads
 * and lobby discovery both apply this one rule.
 */
export const hostIdentityHidden = (
  room: { readonly hostActorId: string; readonly hostIsHumanJudge: boolean },
  viewerActorId: string,
) => room.hostIsHumanJudge && room.hostActorId !== viewerActorId;

/**
 * Server projection: consumers never infer startability or consent from
 * local device state. Every field is built explicitly — nothing internal is
 * spread — so a host list, draw texts or the seed cannot ride along. The
 * Room is settled at `now` first, without writing.
 */
export function projectRoom(
  stored: RoomAssemblyState,
  actorId: string,
  consent: RoomConsent,
  now: string,
  drawSeed: Uint8Array | null,
): RoomView {
  const room = settleRoom(stored, drawSeed, now);
  const blocker = startBlocker(room, consent, now);
  const hidden = hiddenJudges(room, actorId);
  const hostHidden = hostIdentityHidden(
    {
      hostActorId: room.hostActorId,
      hostIsHumanJudge: room.participants.some(
        (p) =>
          p.actorId === room.hostActorId &&
          p.role === 'judge' &&
          p.kind === 'human',
      ),
    },
    actorId,
  );
  const phase = preRoundPhase(room, now);
  const source = room.config.resolutionDraw.enabled
    ? room.config.resolutionDraw.source
    : null;
  return {
    id: room.id,
    version: room.version,
    changeVersion: room.changeVersion,
    title: room.title,
    topic: room.topic,
    visibility: room.visibility,
    hostActorId: hostHidden ? null : room.hostActorId,
    hostLabel: hostHidden ? null : room.hostLabel,
    botAdmission: null,
    status: room.status,
    formatId: room.formatId,
    formatVersion: room.formatVersion,
    presetVersion: room.presetVersion,
    competitionType: room.competitionType,
    definition: room.definition,
    config: freezeRoomConfig(room.config),
    executionPlan: freezeRoomExecutionPlan(room.executionPlan),
    authoredDrawSource:
      source?.kind === 'host' &&
      room.hostActorId === actorId &&
      assemblyOpen(room)
        ? { resolutions: source.resolutions }
        : null,
    resolutionDraw: room.resolutionDraw
      ? projectDraw(room, actorId, phase)
      : null,
    rules: room.rules,
    participants: room.participants.map((p) => {
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
        : {
            id: p.id,
            actorId: p.actorId,
            kind: p.kind,
            label: p.label,
            consentVersion: p.consentVersion,
            role: p.role,
            slot: p.slot,
            ...state,
          };
    }),
    readiness: {
      available: consent.available,
      version: room.version,
      readyActorIds: consent.readyActorIds.filter((id) => !hidden.has(id)),
    },
    prep: prepView(room, now),
    capabilities: roomCapabilities(room, actorId, blocker, now, phase),
    startRefusal: blocker,
    roundRef: room.roundRef,
  };
}

/** Seated debaters see every drawn text; everyone else sees progress only. */
const projectDraw = (
  room: RoomAssemblyState,
  actorId: string,
  phase: PreRoundPhase,
): ResolutionDrawView => {
  const draw = room.resolutionDraw!;
  const turn =
    phase.phase === 'striking'
      ? {
          ordinal: phase.turn.ordinal,
          side: phase.turn.side,
          dueAt: phase.turn.dueAt,
        }
      : null;
  const revealedAt = survivorOf(draw)?.at ?? null;
  const debater = room.participants.some(
    (p) =>
      p.actorId === actorId &&
      (p.role === 'affirmative' || p.role === 'negative'),
  );
  if (!debater)
    return {
      visibility: 'progress',
      drawSize: draw.manifest.drawSize,
      strikes: draw.strikes.map(({ ordinal, side, kind }) => ({
        ordinal,
        side,
        kind,
      })),
      turn,
      revealedAt,
    };
  return {
    visibility: 'debater',
    commitment: draw.commitment,
    drawSize: draw.manifest.drawSize,
    items: draw.items.map(({ position, text, category }) => ({
      position,
      text,
      category,
    })),
    strikes: draw.strikes.map(({ ordinal, side, kind, position }) => ({
      ordinal,
      side,
      kind,
      position,
    })),
    turn,
    revealedAt,
  };
};

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
const roomCapabilities = (
  room: RoomAssemblyState,
  actorId: string,
  blocker: RoomView['startRefusal'],
  now: string,
  phase: PreRoundPhase,
): RoomView['capabilities'] => {
  const host = room.hostActorId === actorId;
  const open = assemblyOpen(room);
  const manage = host && open;
  const editable = open && !preRoundBegun(room);
  const own = room.participants.find((p) => p.actorId === actorId);
  return {
    host,
    canEdit: manage && editable && room.competitionType !== 'ranked',
    canClaimSeat: editable,
    canReady: canReady(open, own),
    canStartPreRound: manage && phase.phase === 'not-begun' && complete(room),
    canStrike: open && mayStrike(room, actorId, phase),
    canFinishPrep:
      manage &&
      room.executionPlan.preRoundPrep.enabled &&
      room.prepStartedAt !== null &&
      prepFinished(room, now),
    canStart: host && blocker === null,
  };
};
const canReady = (
  open: boolean,
  own: RoomAssemblyState['participants'][number] | undefined,
) => open && own?.kind === 'human' && own.eligible;
