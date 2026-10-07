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

export type ResolveRefusalKind =
  | 'capability-forbidden'
  | 'out-of-range'
  | 'unknown-segment-key'
  | 'invalid-choice'
  | 'incomplete-timing';

export type ResolveRefusal = {
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

const refused = (
  kind: ResolveRefusalKind,
  message: string,
): ResolveOutcome => ({
  ok: false,
  refusal: { kind, message },
});

const within = (value: number, range: { min: number; max: number }) =>
  value >= range.min && value <= range.max;

/**
 * Resolves one room configuration against one format definition. Every
 * field of the output traces to a declared input: segment identity is the
 * definition's verbatim, durations are the override within bounds else the
 * default, budgets and choices are the config's within the definition's
 * declared ranges, and a capability the definition nulls out has nothing
 * to resolve.
 */
export function resolveRoomConfiguration(
  definition: FormatDefinition,
  config: RoomConfig,
): ResolveOutcome {
  const { configurable } = definition;
  const overrides = config.speechTiming.segmentDurationOverrides;

  // An override naming no segment of this format is a typo, not a preference.
  for (const key of Object.keys(overrides))
    if (!definition.segments.some((segment) => segment.key === key))
      return refused(
        'unknown-segment-key',
        `Override names unknown segment ${key}`,
      );

  const segments: RoundRules['segments'] = [];
  for (const segment of definition.segments) {
    const override = overrides[segment.key];
    if (override !== undefined) {
      const bounds = configurable.timing.segmentDurationMs[segment.key];
      if (!bounds)
        return refused(
          'incomplete-timing',
          `Segment ${segment.key} has no declared timing bounds to resolve its override against`,
        );
      if (!within(override, bounds))
        return refused(
          'out-of-range',
          `Segment ${segment.key} duration ${override}ms is outside ${bounds.min}-${bounds.max}ms`,
        );
      segments.push({ ...segment, durationMs: override });
      continue;
    }
    // Unreachable for a parsed definition, which requires a positive
    // default on every segment; the guard is what makes the totality
    // claim true of the compiler itself rather than of the schema.
    if (!(segment.defaultDurationMs > 0))
      return refused(
        'incomplete-timing',
        `Segment ${segment.key} has neither an override nor a usable default`,
      );
    segments.push({ ...segment, durationMs: segment.defaultDurationMs });
  }

  let preRoundPrep: RoomExecutionPlan['preRoundPrep'] = { enabled: false };
  if (config.preRoundPrep.enabled) {
    const bounds = configurable.preRoundPrep;
    if (bounds === null)
      return refused(
        'capability-forbidden',
        'The format forbids pre-round prep',
      );
    if (!within(config.preRoundPrep.durationMs, bounds.durationMs))
      return refused(
        'out-of-range',
        `Pre-round prep ${config.preRoundPrep.durationMs}ms is outside ${bounds.durationMs.min}-${bounds.durationMs.max}ms`,
      );
    preRoundPrep = config.preRoundPrep;
  }

  let inRoundPrep: RoundRules['inRoundPrep'] = null;
  if (config.inRoundPrep.enabled) {
    const bounds = configurable.inRoundPrep;
    if (bounds === null)
      return refused(
        'capability-forbidden',
        'The format forbids in-round prep',
      );
    if (!within(config.inRoundPrep.budgetMsPerSide, bounds.budgetMsPerSide))
      return refused(
        'out-of-range',
        `In-round prep ${config.inRoundPrep.budgetMsPerSide}ms per side is outside ${bounds.budgetMsPerSide.min}-${bounds.budgetMsPerSide.max}ms`,
      );
    const { expiresAtSegment } = bounds;
    if (
      expiresAtSegment !== null &&
      !definition.segments.some((segment) => segment.key === expiresAtSegment)
    )
      return refused(
        'unknown-segment-key',
        `Prep expires at unknown segment ${expiresAtSegment}`,
      );
    // When prep may be spent is structure: the room chose only the budget.
    inRoundPrep = {
      budgetMsPerSide: config.inRoundPrep.budgetMsPerSide,
      spendableBefore: bounds.spendableBefore,
      expiresAtSegment,
    };
  }

  if (!within(config.speechTiming.countdownMs, configurable.timing.countdownMs))
    return refused(
      'out-of-range',
      `Countdown ${config.speechTiming.countdownMs}ms is outside ${configurable.timing.countdownMs.min}-${configurable.timing.countdownMs.max}ms`,
    );

  if (
    !configurable.interaction.crossExModes.includes(
      config.crossExamination.crossExMode,
    )
  )
    return refused(
      'invalid-choice',
      `Cross-examination mode ${config.crossExamination.crossExMode} is not permitted`,
    );

  let interruptions: RoundRules['interaction']['interruptions'] = null;
  if (config.interruptions !== null) {
    const capability = configurable.interaction.interruptions;
    if (capability === null)
      return refused(
        'capability-forbidden',
        'The format forbids interruptions',
      );
    if (!capability.modes.includes(config.interruptions.mode))
      return refused(
        'invalid-choice',
        `Interruption mode ${config.interruptions.mode} is not permitted`,
      );
    if (!within(config.interruptions.minRemainingMs, capability.minRemainingMs))
      return refused(
        'out-of-range',
        `Interruption minimum remaining ${config.interruptions.minRemainingMs}ms is outside ${capability.minRemainingMs.min}-${capability.minRemainingMs.max}ms`,
      );
    interruptions = {
      allowed: config.interruptions.mode,
      minRemainingMs: config.interruptions.minRemainingMs,
    };
  }

  let yieldRule: RoundRules['interaction']['yield'] = null;
  if (config.yielding !== null) {
    const capability = configurable.interaction.yield;
    if (capability === null)
      return refused('capability-forbidden', 'The format forbids yielding');
    if (!capability.enabledChoices.includes(config.yielding.allowed))
      return refused(
        'invalid-choice',
        `Yielding ${config.yielding.allowed ? 'allowed' : 'disallowed'} is not a permitted choice`,
      );
    if (!capability.returnsTimeChoices.includes(config.yielding.returnsTime))
      return refused(
        'invalid-choice',
        `Returning time on yield ${config.yielding.returnsTime ? 'enabled' : 'disabled'} is not a permitted choice`,
      );
    yieldRule = {
      allowed: config.yielding.allowed,
      returnsTime: config.yielding.returnsTime,
    };
  }

  return {
    ok: true,
    roomPlan: { preRoundPrep },
    rules: {
      version: 2,
      seats: definition.seats,
      segments,
      inRoundPrep,
      countdownMs: config.speechTiming.countdownMs,
      interaction: {
        crossExMode: config.crossExamination.crossExMode,
        yield: yieldRule,
        interruptions,
      },
    },
  };
}
