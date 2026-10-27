import type {
  FormatDefinition,
  RoomConfig,
  RoomExecutionPlan,
} from '@daisy/protocol';
import { stepRefused, within, type Step } from './resolve-steps';

/** Resolves the Room-executed pre-round prep, or refuses. */
export function resolvePreRoundPrep(
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

/** Resolves the Room-executed resolution draw, or refuses. */
export function resolveResolutionDraw(
  definition: FormatDefinition,
  config: RoomConfig,
): Step<RoomExecutionPlan['resolutionDraw']> {
  const draw = config.resolutionDraw;
  if (!draw.enabled) return { ok: true, value: draw };
  const bounds = definition.configurable.resolutionDraw;
  if (bounds === null)
    return stepRefused(
      'capability-forbidden',
      'The format forbids a resolution draw',
    );
  if (!within(draw.drawSize, bounds.drawSize))
    return stepRefused(
      'out-of-range',
      `Draw size ${draw.drawSize} is outside ${bounds.drawSize.min}-${bounds.drawSize.max}`,
    );
  if (!within(draw.strikeWindowMs, bounds.strikeWindowMs))
    return stepRefused(
      'out-of-range',
      `Strike window ${draw.strikeWindowMs}ms is outside ${bounds.strikeWindowMs.min}-${bounds.strikeWindowMs.max}ms`,
    );
  if (!bounds.firstStrikers.includes(draw.firstStriker))
    return stepRefused(
      'invalid-choice',
      `First striker ${draw.firstStriker} is not permitted`,
    );
  if (!bounds.sources.includes(draw.source.kind))
    return stepRefused(
      'invalid-choice',
      `Draw source ${draw.source.kind} is not permitted`,
    );
  return { ok: true, value: draw };
}
