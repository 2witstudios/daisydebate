import { debaterSeatsHeldFrom } from './room-edit-transitions';
import { formatStanding } from './format-standing';
import type { RoomAssemblyState, RoomConsent, RoomView } from '@daisy/protocol';
import { freezeRoomConfig, freezeRoomExecutionPlan } from '@daisy/protocol';
import { assemblyOpen, startBlocker } from './room-assembly-facts';
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
 * unless the viewer is that judge or the host who seats them. A host who
 * inherited the Room names none (DEC-331).
 */
const hiddenJudges = (room: RoomAssemblyState, actorId: string) =>
  new Set(
    room.hostActorId === actorId && !room.hostInherited
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
 * spread — so a host list cannot ride along.
 */
export function projectRoom(
  room: RoomAssemblyState,
  actorId: string,
  consent: RoomConsent,
  now: string,
): RoomView {
  const blocker = startBlocker(room, consent);
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
    aiJudgeSeating: null,
    contentWaiver: null,
    captureOffer: null,
    capture: room.capture,
    captureNotice: null,
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
    format: {
      ...room.catalogFormat,
      basis: room.basis && {
        formatId: room.basis.formatId,
        name: room.basis.name,
        formatVersion: room.basis.formatVersion,
        presetVersion: room.basis.presetVersion,
        strikes: room.basis.config.resolutionDraw.enabled,
      },
      standing: formatStanding({
        active: {
          formatId: room.formatId,
          formatVersion: room.formatVersion,
          definition: room.definition,
          config: room.config,
        },
        basis: room.basis,
      }),
    },
    readiness: {
      available: consent.available,
      version: room.version,
      readyActorIds: consent.readyActorIds.filter((id) => !hidden.has(id)),
    },
    debaterSeatsHeldFromViewer:
      room.status === 'assembling' || room.status === 'ready'
        ? debaterSeatsHeldFrom(room, actorId, now)
        : 0,
    capabilities: roomCapabilities(room, actorId, blocker),
    startRefusal: blocker,
    // A non-participant learns of a live Round only from the spectator timeline.
    roundRef:
      room.hostActorId === actorId ||
      room.participants.some((p) => p.actorId === actorId)
        ? room.roundRef
        : null,
  };
}

const roomCapabilities = (
  room: RoomAssemblyState,
  actorId: string,
  blocker: RoomView['startRefusal'],
): RoomView['capabilities'] => {
  const host = room.hostActorId === actorId;
  const open = assemblyOpen(room);
  const own = room.participants.find((p) => p.actorId === actorId);
  return {
    host,
    canEdit: host && open && room.competitionType !== 'ranked',
    canClaimSeat: open,
    canReady: canReady(open, own),
    canStart: host && blocker === null,
  };
};
const canReady = (
  open: boolean,
  own: RoomAssemblyState['participants'][number] | undefined,
) => open && own?.kind === 'human' && own.eligible;
