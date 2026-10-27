import type {
  FormatDefinition,
  FormatSelectionFacts,
  RoomConfig,
} from '@daisy/protocol';

export type { FormatSelectionFacts };
import {
  resolveRoomConfiguration,
  type ResolveOutcome,
} from './resolve-room-configuration';

/**
 * Why a format is being selected. New selections (`create-casual`,
 * `choose`) take what the picker offers; `create-ranked` takes what ranked
 * play admits; `reset` restores the room's own pinned basis.
 */
type FormatSelectionIntent =
  'create-casual' | 'create-ranked' | 'choose' | 'reset';

type FormatBasis = {
  readonly formatId: string;
  readonly presetVersion: number;
};

export type FormatSelectionRequest = {
  readonly intent: FormatSelectionIntent;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number;
  /** The room's current basis; only `reset` reads it. */
  readonly basis: FormatBasis | null;
};

type FormatSelectionOutcome =
  | {
      readonly ok: true;
      readonly definition: FormatDefinition;
      readonly config: RoomConfig;
      readonly resolved: Extract<ResolveOutcome, { ok: true }>;
      /** The catalog preset a casual room is based on; null for ranked play. */
      readonly basis: FormatBasis | null;
      /** The preset a ranked room pins; null for casual play. */
      readonly rankedPresetVersion: number | null;
    }
  | {
      readonly ok: false;
      readonly refusal: 'format-unavailable' | 'illegal-config';
    };

const unavailable = {
  ok: false,
  refusal: 'format-unavailable',
} as const satisfies FormatSelectionOutcome;

/** The requested tuple is exactly what was loaded. */
const sameTuple = (
  request: FormatSelectionRequest,
  facts: FormatSelectionFacts,
) =>
  facts.format.id === request.formatId &&
  facts.preset.version === request.presetVersion &&
  facts.preset.formatVersion === request.formatVersion;

/** The tuple names today's definition and today's preset. */
const isCurrent = (facts: FormatSelectionFacts) =>
  facts.preset.current &&
  facts.preset.formatVersion === facts.format.currentVersion;

const oneOnOneSeats = ({ seats }: FormatDefinition) =>
  seats.affirmative === 1 && seats.negative === 1 && seats.judge === 1;

/** Ranked admission: the current eligible preset of a 1/1/1 format, no picker role needed. */
const rankedAdmits = (facts: FormatSelectionFacts) =>
  isCurrent(facts) &&
  facts.preset.rankedEligible &&
  oneOnOneSeats(facts.definition);

/** A reset names the room's own pinned basis exactly. */
const isOwnBasis = (request: FormatSelectionRequest) =>
  request.basis !== null &&
  request.basis.formatId === request.formatId &&
  request.basis.presetVersion === request.presetVersion;

const admissions: Readonly<
  Record<
    FormatSelectionIntent,
    (request: FormatSelectionRequest, facts: FormatSelectionFacts) => boolean
  >
> = {
  'create-casual': (_request, facts) =>
    facts.format.role !== null && isCurrent(facts),
  choose: (_request, facts) => facts.format.role !== null && isCurrent(facts),
  'create-ranked': (_request, facts) => rankedAdmits(facts),
  reset: (request) => isOwnBasis(request),
};

/** Whether the intent may use these facts, before compiling. */
const admitted = (
  request: FormatSelectionRequest,
  facts: FormatSelectionFacts,
) =>
  facts.format.catalogOwned &&
  sameTuple(request, facts) &&
  admissions[request.intent](request, facts);

/**
 * The one decision every format selection goes through: create, ranked
 * create, choosing in Room setup and Back to standard. Pure; the adapter
 * loads `facts` for the requested tuple (null when absent) under the locks
 * that serialize it with publication, and never substitutes another preset.
 */
export function decideFormatSelection(
  request: FormatSelectionRequest,
  facts: FormatSelectionFacts | null,
): FormatSelectionOutcome {
  if (!facts || !admitted(request, facts)) return unavailable;
  const resolved = resolveRoomConfiguration(
    facts.definition,
    facts.preset.config,
  );
  if (!resolved.ok) return { ok: false, refusal: 'illegal-config' };
  const ranked = request.intent === 'create-ranked';
  return {
    ok: true,
    definition: facts.definition,
    config: facts.preset.config,
    resolved,
    basis: ranked
      ? null
      : { formatId: facts.format.id, presetVersion: facts.preset.version },
    rankedPresetVersion: ranked ? facts.preset.version : null,
  };
}
