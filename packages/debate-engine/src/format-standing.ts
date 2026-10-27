import type {
  DebateRole,
  FormatChange,
  FormatDefinition,
  FormatStanding,
  RoomConfig,
  RoomExecutionPlan,
  RoundRules,
} from '@daisy/protocol';
import { freezeRoomExecutionPlan } from '@daisy/protocol';
import { resolveRoomConfiguration } from './resolve-room-configuration';

type ActiveFormat = {
  readonly formatId: string;
  readonly formatVersion: number;
  readonly definition: FormatDefinition;
  readonly config: RoomConfig;
};

/** The catalog preset a room started from, with the definition it pins. */
export type StandingBasis = {
  readonly formatId: string;
  readonly presetVersion: number;
  readonly formatVersion: number;
  readonly role: 'standard' | 'template';
  readonly definition: FormatDefinition;
  readonly config: RoomConfig;
};

type Compiled = {
  readonly rules: RoundRules;
  readonly plan: RoomExecutionPlan;
};

const compile = (
  definition: FormatDefinition,
  config: RoomConfig,
): Compiled | null => {
  const outcome = resolveRoomConfiguration(definition, config);
  return outcome.ok ? { rules: outcome.rules, plan: outcome.roomPlan } : null;
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const roles: readonly DebateRole[] = ['affirmative', 'negative', 'judge'];

function segmentChanges(from: RoundRules, to: RoundRules): FormatChange[] {
  const fromKeys = from.segments.map((s) => s.key);
  const toKeys = to.segments.map((s) => s.key);
  const kept = toKeys.filter((key) => fromKeys.includes(key));
  // Position counts among kept segments only, so removing or adding one
  // never marks every later segment as changed.
  const identity = (rules: RoundRules, key: string) => {
    const segment = rules.segments.find((s) => s.key === key)!;
    const order = rules.segments
      .map((s) => s.key)
      .filter((k) => kept.includes(k))
      .indexOf(key);
    return [order, segment.label, segment.type, segment.side, segment.slot];
  };
  const structure = {
    kind: 'segments' as const,
    added: toKeys.filter((key) => !fromKeys.includes(key)),
    removed: fromKeys.filter((key) => !toKeys.includes(key)),
    changed: kept.filter(
      (key) => !same(identity(from, key), identity(to, key)),
    ),
  };
  const durations = kept.flatMap((key) => {
    const fromMs = from.segments.find((s) => s.key === key)!.durationMs;
    const toMs = to.segments.find((s) => s.key === key)!.durationMs;
    return fromMs === toMs
      ? []
      : [{ kind: 'segment-duration' as const, key, fromMs, toMs }];
  });
  const restructured =
    structure.added.length +
      structure.removed.length +
      structure.changed.length >
    0;
  return [...(restructured ? [structure] : []), ...durations];
}

/** Every rule that differs between two compiled formats, in a stable order. */
function changesBetween(from: Compiled, to: Compiled): FormatChange[] {
  const seats = roles.flatMap((role) =>
    from.rules.seats[role] === to.rules.seats[role]
      ? []
      : [
          {
            kind: 'seats' as const,
            role,
            from: from.rules.seats[role],
            to: to.rules.seats[role],
          },
        ],
  );
  const prepMs = (rules: RoundRules) =>
    rules.inRoundPrep?.budgetMsPerSide ?? null;
  const preRoundMs = (plan: RoomExecutionPlan) =>
    plan.preRoundPrep.enabled ? plan.preRoundPrep.durationMs : null;
  const scalar: FormatChange[] = [
    {
      kind: 'countdown',
      fromMs: from.rules.countdownMs,
      toMs: to.rules.countdownMs,
    },
    {
      kind: 'in-round-prep',
      fromMs: prepMs(from.rules),
      toMs: prepMs(to.rules),
    },
    {
      kind: 'pre-round-prep',
      fromMs: preRoundMs(from.plan),
      toMs: preRoundMs(to.plan),
    },
    {
      kind: 'cross-ex-mode',
      from: from.rules.interaction.crossExMode,
      to: to.rules.interaction.crossExMode,
    },
    {
      kind: 'interruptions',
      from: from.rules.interaction.interruptions,
      to: to.rules.interaction.interruptions,
    },
    {
      kind: 'yield',
      from: from.rules.interaction.yield,
      to: to.rules.interaction.yield,
    },
    {
      kind: 'resolution-draw',
      from: freezeRoomExecutionPlan(from.plan).resolutionDraw,
      to: freezeRoomExecutionPlan(to.plan).resolutionDraw,
    },
  ].filter((change) =>
    'fromMs' in change
      ? change.fromMs !== change.toMs
      : !same(change.from, change.to),
  ) as FormatChange[];
  return [...seats, ...segmentChanges(from.rules, to.rules), ...scalar];
}

/**
 * Whether a room still runs its standard format, derived and never stored.
 * Standard needs a standard basis, the same format identity and revision,
 * and the same compiled rules and room plan, so an override equal to the
 * default stays Standard. A template basis is always Custom, and a room
 * with no basis is plain Custom.
 */
/** The standing of a room whose rules equal its basis's: Standard for a standard. */
const unchangedStanding = (basis: StandingBasis): FormatStanding =>
  basis.role === 'standard'
    ? { kind: 'standard', formatId: basis.formatId }
    : {
        kind: 'custom',
        basis: { formatId: basis.formatId, role: basis.role },
        changes: [],
      };

export function formatStanding({
  active,
  basis,
}: {
  readonly active: ActiveFormat;
  readonly basis: StandingBasis | null;
}): FormatStanding {
  if (!basis) return { kind: 'custom', basis: null, changes: [] };
  const sameIdentity =
    active.formatId === basis.formatId &&
    active.formatVersion === basis.formatVersion;
  // A room untouched since its basis needs no compile: every read of an
  // unchanged room (each countdown reread included) answers from the inputs.
  if (
    sameIdentity &&
    same(active.definition, basis.definition) &&
    same(active.config, basis.config)
  )
    return unchangedStanding(basis);
  const from = compile(basis.definition, basis.config);
  const to = compile(active.definition, active.config);
  if (!from || !to)
    return {
      kind: 'custom',
      basis: { formatId: basis.formatId, role: basis.role },
      changes: [],
    };
  return sameIdentity && same(from, to)
    ? unchangedStanding(basis)
    : {
        kind: 'custom',
        basis: { formatId: basis.formatId, role: basis.role },
        changes: changesBetween(from, to),
      };
}
