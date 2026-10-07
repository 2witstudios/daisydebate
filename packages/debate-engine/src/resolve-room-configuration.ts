import type {
  FormatDefinition,
  RoomConfig,
  RoomExecutionPlan,
  RoundRules,
} from '@daisy/protocol';

/**
 * The one compiler (ADR 0058): pure and total over two declared inputs. For
 * every valid (FormatDefinition, RoomConfig) pair it produces every field
 * ECS reads — no fallback, no default, no "if undefined then …" branch in
 * engine code. A value that cannot be resolved is a named refusal at
 * resolution time, never a silent default at run time. The ranked/casual
 * distinction is upstream: this function never sees competition_type,
 * format ids or the repository, only the definition and the config, which
 * is what keeps its refusal set closed and its totality provable.
 */

type ResolveRefusalKind =
  | 'capability-forbidden'
  | 'out-of-range'
  | 'unknown-segment-key'
  | 'invalid-choice'
  | 'incomplete-timing';

type ResolveRefusal = {
  readonly kind: ResolveRefusalKind;
  /** What was refused and why, for the operator and the logs. */
  readonly message: string;
};

export type ResolveOutcome =
  | {
      readonly ok: true;
      /** Room-executed: what the Room runs before competition. */
      readonly roomPlan: RoomExecutionPlan;
      /** Round-executed: frozen onto `rounds.rules_snapshot`. */
      readonly rules: RoundRules;
    }
  | { readonly ok: false; readonly refusal: ResolveRefusal };

/** One step's outcome: a resolved value or a refusal. */
type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ResolveRefusal };

const refusalOf = (
  kind: ResolveRefusalKind,
  message: string,
): ResolveRefusal => ({ kind, message });
const refused = (
  kind: ResolveRefusalKind,
  message: string,
): ResolveOutcome => ({ ok: false, refusal: refusalOf(kind, message) });
const stepRefused = (
  kind: ResolveRefusalKind,
  message: string,
): { readonly ok: false; readonly refusal: ResolveRefusal } => ({
  ok: false,
  refusal: refusalOf(kind, message),
});

const within = (value: number, range: { min: number; max: number }) =>
  value >= range.min && value <= range.max;

/** The rules' segment: the definition's identity verbatim, nothing else —
 * in particular never the definition's own `defaultDurationMs`, which is
 * compiler input, not resolved rules. */
const resolvedSegment = (
  segment: FormatDefinition['segments'][number],
  durationMs: number,
): RoundRules['segments'][number] => ({
  key: segment.key,
  label: segment.label,
  type: segment.type,
  side: segment.side,
  slot: segment.slot,
  durationMs,
});

/**
 * Resolves one room configuration against one format definition. Every
 * field of the output traces to a declared input: segment identity is the
 * definition's verbatim, durations are the override within bounds else the
 * default, budgets and choices are the config's within the definition's
 * declared ranges, and a capability the definition nulls out has nothing
 * to resolve.
 */
type Interaction = RoundRules['interaction'];

/** Resolves the schedule: every segment's duration from override or default. */
function resolveSegments(
  definition: FormatDefinition,
  overrides: RoomConfig['speechTiming']['segmentDurationOverrides'],
): Step<RoundRules['segments']> {
  // An override naming no segment of this format is a typo, not a preference.
  for (const key of Object.keys(overrides))
    if (!definition.segments.some((segment) => segment.key === key))
      return stepRefused(
        'unknown-segment-key',
        `Override names unknown segment ${key}`,
      );
  const segments: RoundRules['segments'] = [];
  for (const segment of definition.segments) {
    const override = overrides[segment.key];
    if (override !== undefined) {
      const bounds =
        definition.configurable.timing.segmentDurationMs[segment.key];
      if (!bounds)
        return stepRefused(
          'incomplete-timing',
          `Segment ${segment.key} has no declared timing bounds to resolve its override against`,
        );
      if (!within(override, bounds))
        return stepRefused(
          'out-of-range',
          `Segment ${segment.key} duration ${override}ms is outside ${bounds.min}-${bounds.max}ms`,
        );
      segments.push(resolvedSegment(segment, override));
      continue;
    }
    // Unreachable for a parsed definition, which requires a positive
    // default on every segment; the guard is what makes the totality
    // claim true of the compiler itself rather than of the schema.
    if (!(segment.defaultDurationMs > 0))
      return stepRefused(
        'incomplete-timing',
        `Segment ${segment.key} has neither an override nor a usable default`,
      );
    segments.push(resolvedSegment(segment, segment.defaultDurationMs));
  }
  return { ok: true, value: segments };
}

/** Resolves the Room-executed pre-round prep, or refuses. */
function resolvePreRoundPrep(
  definition: FormatDefinition,
  config: RoomConfig,
): Step<RoomExecutionPlan['preRoundPrep']> {
  if (!config.preRoundPrep.enabled)
    return { ok: true, value: config.preRoundPrep };
  const bounds = definition.configurable.preRoundPrep;
  if (bounds === null)
    return stepRefused(
      'capability-forbidden',
      'The format forbids pre-round prep',
    );
  if (!within(config.preRoundPrep.durationMs, bounds.durationMs))
    return stepRefused(
      'out-of-range',
      `Pre-round prep ${config.preRoundPrep.durationMs}ms is outside ${bounds.durationMs.min}-${bounds.durationMs.max}ms`,
    );
  return { ok: true, value: config.preRoundPrep };
}

/** Resolves the ECS-enforced in-round budget, or refuses. */
function resolveInRoundPrep(
  definition: FormatDefinition,
  config: RoomConfig,
): Step<RoundRules['inRoundPrep']> {
  if (!config.inRoundPrep.enabled) return { ok: true, value: null };
  const bounds = definition.configurable.inRoundPrep;
  if (bounds === null)
    return stepRefused(
      'capability-forbidden',
      'The format forbids in-round prep',
    );
  if (!within(config.inRoundPrep.budgetMsPerSide, bounds.budgetMsPerSide))
    return stepRefused(
      'out-of-range',
      `In-round prep ${config.inRoundPrep.budgetMsPerSide}ms per side is outside ${bounds.budgetMsPerSide.min}-${bounds.budgetMsPerSide.max}ms`,
    );
  const { expiresAtSegment } = bounds;
  if (
    expiresAtSegment !== null &&
    !definition.segments.some((segment) => segment.key === expiresAtSegment)
  )
    return stepRefused(
      'unknown-segment-key',
      `Prep expires at unknown segment ${expiresAtSegment}`,
    );
  // When prep may be spent is structure: the room chose only the budget.
  return {
    ok: true,
    value: {
      budgetMsPerSide: config.inRoundPrep.budgetMsPerSide,
      spendableBefore: bounds.spendableBefore,
      expiresAtSegment,
    },
  };
}

/** Resolves the interruption policy, or refuses when the choice is not permitted. */
function resolveInterruptions(
  definition: FormatDefinition,
  config: RoomConfig,
): Step<Interaction['interruptions']> {
  if (config.interruptions === null) return { ok: true, value: null };
  const capability = definition.configurable.interaction.interruptions;
  if (capability === null)
    return stepRefused('capability-forbidden', 'The format forbids interruptions');
  if (!capability.modes.includes(config.interruptions.mode))
    return stepRefused(
      'invalid-choice',
      `Interruption mode ${config.interruptions.mode} is not permitted`,
    );
  if (!within(config.interruptions.minRemainingMs, capability.minRemainingMs))
    return stepRefused(
      'out-of-range',
      `Interruption minimum remaining ${config.interruptions.minRemainingMs}ms is outside ${capability.minRemainingMs.min}-${capability.minRemainingMs.max}ms`,
    );
  return {
    ok: true,
    value: {
      allowed: config.interruptions.mode,
      minRemainingMs: config.interruptions.minRemainingMs,
    },
  };
}

/** Resolves the yield policy, or refuses when the choice is not permitted. */
function resolveYieldRule(
  definition: FormatDefinition,
  config: RoomConfig,
): Step<Interaction['yield']> {
  if (config.yielding === null) return { ok: true, value: null };
  const capability = definition.configurable.interaction.yield;
  if (capability === null)
    return stepRefused('capability-forbidden', 'The format forbids yielding');
  if (!capability.enabledChoices.includes(config.yielding.allowed))
    return stepRefused(
      'invalid-choice',
      `Yielding ${config.yielding.allowed ? 'allowed' : 'disallowed'} is not a permitted choice`,
    );
  if (!capability.returnsTimeChoices.includes(config.yielding.returnsTime))
    return stepRefused(
      'invalid-choice',
      `Returning time on yield ${config.yielding.returnsTime ? 'enabled' : 'disabled'} is not a permitted choice`,
    );
  return {
    ok: true,
    value: {
      allowed: config.yielding.allowed,
      returnsTime: config.yielding.returnsTime,
    },
  };
}

/** Resolves the interaction rules: CX mode, yield and interruptions. */
function resolveInteraction(
  definition: FormatDefinition,
  config: RoomConfig,
): Step<Interaction> {
  const { interaction } = definition.configurable;
  if (!interaction.crossExModes.includes(config.crossExamination.crossExMode))
    return stepRefused(
      'invalid-choice',
      `Cross-examination mode ${config.crossExamination.crossExMode} is not permitted`,
    );
  const interruptions = resolveInterruptions(definition, config);
  if (!interruptions.ok) return interruptions;
  const yieldRule = resolveYieldRule(definition, config);
  if (!yieldRule.ok) return yieldRule;
  return {
    ok: true,
    value: {
      crossExMode: config.crossExamination.crossExMode,
      yield: yieldRule.value,
      interruptions: interruptions.value,
    },
  };
}

export function resolveRoomConfiguration(
  definition: FormatDefinition,
  config: RoomConfig,
): ResolveOutcome {
  const schedule = resolveSegments(
    definition,
    config.speechTiming.segmentDurationOverrides,
  );
  if (!schedule.ok) return schedule;
  const preRoundPrep = resolvePreRoundPrep(definition, config);
  if (!preRoundPrep.ok) return preRoundPrep;
  const inRoundPrep = resolveInRoundPrep(definition, config);
  if (!inRoundPrep.ok) return inRoundPrep;
  if (
    !within(
      config.speechTiming.countdownMs,
      definition.configurable.timing.countdownMs,
    )
  )
    return refused(
      'out-of-range',
      `Countdown ${config.speechTiming.countdownMs}ms is outside ${definition.configurable.timing.countdownMs.min}-${definition.configurable.timing.countdownMs.max}ms`,
    );
  const interaction = resolveInteraction(definition, config);
  if (!interaction.ok) return interaction;
  return {
    ok: true,
    roomPlan: { preRoundPrep: preRoundPrep.value },
    rules: {
      version: 2,
      seats: definition.seats,
      segments: schedule.value,
      inRoundPrep: inRoundPrep.value,
      countdownMs: config.speechTiming.countdownMs,
      interaction: interaction.value,
    },
  };
}
