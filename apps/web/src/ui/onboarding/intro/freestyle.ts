import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { catalogFormats } from '@daisy/db/catalog-formats';
import { roundLength } from '../../../features/debate-room/vocabulary';

/**
 * Freestyle as the intro teaches it: the format a new member's first
 * debates run on, at its catalog preset. Every number the slides show is
 * read from here, so the intro cannot drift from the round members get.
 */
const freestyle = (() => {
  const format = catalogFormats.find((entry) => entry.id === 'freestyle');
  if (format === undefined)
    throw new Error('Freestyle is missing from the format catalog');
  const resolved = resolveRoomConfiguration(format.definition, format.preset);
  if (!resolved.ok) throw new Error(resolved.refusal.message);
  return { format, rules: resolved.rules, preset: format.preset };
})();

export const freestyleRules = freestyle.rules;
export const freestylePreset = freestyle.preset;

export const minutesOf = (ms: number): number => ms / 60_000;

/** Minutes of prep before the round, once the resolution is chosen. */
export const preRoundPrepMinutes = freestyle.preset.preRoundPrep.enabled
  ? minutesOf(freestyle.preset.preRoundPrep.durationMs)
  : 0;

/** How many resolutions the draw offers. */
export const drawSize = freestyle.preset.resolutionDraw.enabled
  ? freestyle.preset.resolutionDraw.drawSize
  : 0;

/** "about 45 min": the room creator's own reckoning, prep included. */
export const freestyleLength = roundLength({
  speechesMs: freestyle.rules.segments.map((segment) => segment.durationMs),
  countdownMs: freestyle.preset.speechTiming.countdownMs,
  prepPerSideMs: freestyle.preset.inRoundPrep.enabled
    ? freestyle.preset.inRoundPrep.budgetMsPerSide
    : null,
  preRoundPrepMs: freestyle.preset.preRoundPrep.enabled
    ? freestyle.preset.preRoundPrep.durationMs
    : 0,
  sideCount: freestyle.rules.sides.length,
});

/** The catalog's templates a custom debate can start from, in catalog order. */
export const catalogTemplates: readonly string[] = catalogFormats
  .filter((entry) => entry.role === 'template')
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map((entry) => entry.name);
