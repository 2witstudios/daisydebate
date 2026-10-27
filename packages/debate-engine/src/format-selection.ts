import type { FormatDefinition, RoomConfig } from '@daisy/protocol';
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

/** What the adapter loaded, under its locks, for the requested tuple. */
export type FormatSelectionFacts = {
  readonly format: {
    readonly id: string;
    readonly name: string;
    readonly leagues: readonly string[];
    /** No owning actor: a publisher catalog row, never a private custom format. */
    readonly catalogOwned: boolean;
    /** Null when the picker does not offer it (One-on-one, Foundation). */
    readonly role: 'standard' | 'template' | null;
    readonly currentVersion: number;
  };
  /** The revision `formatVersion` names. */
  readonly definition: FormatDefinition;
  readonly preset: {
    readonly version: number;
    readonly formatVersion: number;
    readonly config: RoomConfig;
    readonly rankedEligible: boolean;
    /** Not superseded. */
    readonly current: boolean;
  };
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

/** Whether the intent may use these facts, before compiling. */
function admitted(
  request: FormatSelectionRequest,
  facts: FormatSelectionFacts,
): boolean {
  if (!facts.format.catalogOwned || !sameTuple(request, facts)) return false;
  switch (request.intent) {
    case 'create-casual':
    case 'choose':
      return facts.format.role !== null && isCurrent(facts);
    case 'create-ranked':
      return (
        isCurrent(facts) &&
        facts.preset.rankedEligible &&
        oneOnOneSeats(facts.definition)
      );
    case 'reset':
      return (
        request.basis !== null &&
        request.basis.formatId === request.formatId &&
        request.basis.presetVersion === request.presetVersion
      );
  }
}

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
