import { seatsHeldFrom } from './room-edit-transitions';
import { formatStanding } from './format-standing';
import type {
  RoomAssemblyState,
  RoomConsent,
  RoomRoundLink,
  RoomView,
} from '@daisy/protocol';
import {
  freezeRoomConfig,
  freezeRoomExecutionPlan,
  isOpenRoomStatus,
} from '@daisy/protocol';
import { namesHumanJudge, startBlocker } from './room-assembly-facts';
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
 * unless the viewer is that judge or a seatless host who seats them. A host
 * who holds a seat gains nothing from hosting (WATCH-6), and a host who
 * inherited the Room names none (DEC-331).
 */
const hiddenJudges = (room: RoomAssemblyState, actorId: string) =>
  new Set(
    room.participants
      .filter(
        (p) =>
          p.role === 'judge' &&
          p.kind === 'human' &&
          !namesHumanJudge(room, actorId, p.actorId),
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

/** Whether the Room is this viewer's own: they host it or hold a seat in it. */
const ownRoom = (
  room: Pick<RoomAssemblyState, 'hostActorId' | 'participants'>,
  actorId: string,
): boolean =>
  room.hostActorId === actorId ||
  room.participants.some((p) => p.actorId === actorId);

/** Whether this viewer is outside a Room that has started, and so reads it closed. */
export const startHiddenFrom = (
  room: Pick<RoomAssemblyState, 'status' | 'hostActorId' | 'participants'>,
  actorId: string,
): boolean => room.status === 'started' && !ownRoom(room, actorId);

/**
 * A started Room as someone outside it may know it: closed, as an expired or
 * cancelled Room reads, so the read does not say it started (WATCH-6). When it turned
 * closed is known undelayed, and that is accepted: this read holds no horizon, and
 * keeping it `ready` would offer seats and commands that are refused (ADR 0099). A
 * drawn resolution was never public before the Round; the spectator timeline releases
 * it. Commands they send are refused alike, `room-closed` either way.
 */
const roomKnownTo = (
  room: RoomAssemblyState,
  actorId: string,
): RoomAssemblyState =>
  !startHiddenFrom(room, actorId)
    ? room
    : {
        ...room,
        status: 'closed',
        roundRef: null,
        topic: room.config.resolutionDraw.enabled ? null : room.topic,
      };

/**
 * The status and Round one viewer reads of the Room as they may know it
 * (`roomKnownTo`), as the one state the contract holds. A Room still started
 * there is the viewer's own. Only its own people learn a closed Room's Round:
 * anyone else learns of a Round from the spectator timeline alone.
 */
const roundLinkFor = (
  known: RoomAssemblyState,
  actorId: string,
): RoomRoundLink => {
  switch (known.status) {
    case 'assembling':
    case 'ready':
      return { status: known.status, roundRef: null };
    case 'started':
      return { status: known.status, roundRef: known.roundRef };
    case 'closed':
      return {
        status: known.status,
        roundRef: ownRoom(known, actorId) ? known.roundRef : null,
      };
  }
};

/**
 * Server projection: consumers never infer startability or consent from
 * local device state. Every field is built explicitly — nothing internal is
 * spread — so a host list cannot ride along.
 */
export function projectRoom(
  stored: RoomAssemblyState,
  actorId: string,
  consent: RoomConsent,
  now: string,
): RoomView {
  const room = roomKnownTo(stored, actorId);
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
    ...roundLinkFor(room, actorId),
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
    watchRoundId: null,
    // The Room read fills these in for its viewer (ADR 0124).
    invitations: [],
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
      isOpenRoomStatus(room.status)
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
    seatsHeldFromViewer: isOpenRoomStatus(room.status)
      ? {
          debater: seatsHeldFrom(room, actorId, 'debater', now),
          judge: seatsHeldFrom(room, actorId, 'judge', now),
        }
      : { debater: 0, judge: 0 },
    capabilities: roomCapabilities(room, actorId, blocker),
    startRefusal: blocker,
  };
}

const roomCapabilities = (
  room: RoomAssemblyState,
  actorId: string,
  blocker: RoomView['startRefusal'],
): RoomView['capabilities'] => {
  const host = room.hostActorId === actorId;
  const open = isOpenRoomStatus(room.status);
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
