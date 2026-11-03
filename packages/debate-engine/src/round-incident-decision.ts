import {
  roundIncidentPolicy,
  type PlatformIncidentCause,
  type RoundIncident,
} from '@daisy/protocol';

/**
 * What the server read from the vendor in one recovery pass. A browser cannot
 * supply any of this, so no player can cause, hold or end an incident.
 */
export type MediaObservation =
  /** The pass never reached the vendor. */
  | { readonly kind: 'unreachable' }
  /** The pass did other work and read nothing about the room. */
  | { readonly kind: 'unread' }
  | {
      readonly kind: 'room';
      /** Nobody at all is listed: seats, judges and the capture agent. */
      readonly empty: boolean;
      /** The hidden capture agent is listed. */
      readonly captureListed: boolean;
      /** Every seated human debater is listed. */
      readonly seatsListed: boolean;
    };

export type IncidentFacts = {
  readonly incident: RoundIncident;
  readonly nowMs: number;
  readonly observation: MediaObservation;
  /** This pass retired an uncertain room. A revoked seat's rotation is not this. */
  readonly roomRetired: boolean;
  /** The last pass saw the capture agent, so an empty list now means loss. */
  readonly sawCapture: boolean;
  /** When the vendor first went unreachable, or null if it has answered since. */
  readonly unreachableSinceMs: number | null;
  /** A Round in its opening has no capture to wait for. */
  readonly captureExpected: boolean;
};

export type IncidentDecision =
  | { readonly kind: 'pause'; readonly cause: PlatformIncidentCause }
  | { readonly kind: 'begin_resume' }
  | { readonly kind: 'end' }
  | null;

/** The one reading of server evidence as a failure; a planned drain produces none. */
const failureCause = (facts: IncidentFacts): PlatformIncidentCause | null => {
  if (facts.roomRetired) return 'room_retired';
  if (
    facts.observation.kind === 'unreachable' &&
    facts.unreachableSinceMs !== null &&
    facts.nowMs - facts.unreachableSinceMs >=
      roundIncidentPolicy.vendorUnreachableMs
  )
    return 'vendor_unreachable';
  return facts.observation.kind === 'room' &&
    facts.observation.empty &&
    facts.sawCapture
    ? 'room_emptied'
    : null;
};

const heldFacts = (
  facts: IncidentFacts,
  since: string,
): {
  readonly platformBack: boolean;
  readonly seatsBack: boolean;
  readonly heldMs: number;
} => {
  const { observation } = facts;
  const room = observation.kind === 'room' ? observation : null;
  return {
    platformBack:
      room !== null && (room.captureListed || !facts.captureExpected),
    seatsBack: room?.seatsListed ?? false,
    heldMs: facts.nowMs - Date.parse(since),
  };
};

const decisions: {
  readonly [P in RoundIncident['phase']]: (
    facts: IncidentFacts,
    incident: Extract<RoundIncident, { phase: P }>,
  ) => IncidentDecision;
} = {
  none: (facts) => {
    const cause = failureCause(facts);
    return cause === null ? null : { kind: 'pause', cause };
  },
  paused: (facts, incident) => {
    const { platformBack, seatsBack, heldMs } = heldFacts(
      facts,
      incident.since,
    );
    if (
      platformBack &&
      (seatsBack || heldMs >= roundIncidentPolicy.seatGraceMs)
    )
      return { kind: 'begin_resume' };
    return heldMs >= roundIncidentPolicy.recoveryBoundMs
      ? { kind: 'end' }
      : null;
  },
  resuming: (facts, incident) => {
    const cause = failureCause(facts);
    if (cause === null) return null;
    return heldFacts(facts, incident.since).heldMs >=
      roundIncidentPolicy.recoveryBoundMs
      ? { kind: 'end' }
      : { kind: 'pause', cause };
  },
};

/** What server evidence means for this Round now; pure and total. */
export const incidentDecision = (facts: IncidentFacts): IncidentDecision => {
  const { incident } = facts;
  switch (incident.phase) {
    case 'none':
      return decisions.none(facts, incident);
    case 'paused':
      return decisions.paused(facts, incident);
    case 'resuming':
      return decisions.resuming(facts, incident);
  }
};

/**
 * Whether a pass needs the incident transaction at all. An ordinary pass on a
 * healthy Round changes nothing, so it must not cost a Round lock.
 */
export const observationMatters = (facts: IncidentFacts): boolean => {
  const { observation } = facts;
  if (facts.incident.phase !== 'none' || facts.roomRetired) return true;
  if (observation.kind === 'unreachable') return true;
  if (observation.kind === 'unread') return facts.unreachableSinceMs !== null;
  return (
    facts.unreachableSinceMs !== null ||
    observation.empty ||
    observation.captureListed !== facts.sawCapture
  );
};
