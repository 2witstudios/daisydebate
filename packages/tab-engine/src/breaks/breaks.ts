import { compareBytes } from '@daisy/seeded-random';
import type { Id } from '../shapes/competition';
import type { BreakStage, BreaksAnswer, BreaksInput } from '../shapes/folds';
import { clearLine } from './line';
import { candidatesOf, seedOrder } from './seeding';

const lineOf = (input: BreaksInput, stage: BreakStage) => {
  const lines = input.settings['break.line'];
  return (
    (stage.division === null ? undefined : lines.byDivision[stage.division]) ??
    lines.default
  );
};

const qualify = (
  input: BreaksInput,
  stage: BreakStage,
  excluded: (id: Id) => boolean,
): Id[] => {
  const candidates = candidatesOf(input, stage).filter((e) => !excluded(e.id));
  return clearLine(
    seedOrder(input, stage, candidates),
    lineOf(input, stage),
  ).map((s) => s.entry);
};

const resolved = (
  stages: readonly BreakStage[],
  brackets: readonly Id[][],
): BreaksAnswer => ({
  kind: 'resolved',
  stages: stages.map((stage, i) => ({
    stage: stage.id,
    bracket: { seeds: brackets[i]! },
  })),
});

/**
 * The break of each elimination stage, from the preliminary record. Under
 * `higher` an entry already through to an earlier (higher) stage is taken
 * out before a later stage's line is drawn; under `both` stages are drawn
 * independently; under `choice` an entry that chose another stage is taken
 * out first, and anyone still through to two stages without a choice leaves
 * the break undecided.
 */
export const breaks = (input: BreaksInput): BreaksAnswer => {
  const rule = input.settings['break.double_qualifier'].value;
  switch (rule) {
    case 'higher': {
      const taken = new Set<Id>();
      const brackets = input.stages.map((stage) => {
        const seeds = qualify(input, stage, (id) => taken.has(id));
        seeds.forEach((id) => taken.add(id));
        return seeds;
      });
      return resolved(input.stages, brackets);
    }
    case 'both':
      return resolved(
        input.stages,
        input.stages.map((stage) => qualify(input, stage, () => false)),
      );
    case 'choice': {
      const brackets = input.stages.map((stage) =>
        qualify(input, stage, (id) => {
          const chosen = input.choices[id];
          return chosen !== undefined && chosen !== stage.id;
        }),
      );
      const through = new Map<Id, Id[]>();
      brackets.forEach((seeds, i) => {
        for (const id of seeds)
          through.set(id, [...(through.get(id) ?? []), input.stages[i]!.id]);
      });
      const undecided = [...through]
        .filter(
          ([id, stages]) =>
            stages.length > 1 && input.choices[id] === undefined,
        )
        .sort(([a], [b]) => compareBytes(a, b))
        .map(([entry, stages]) => ({ entry, stages }));
      return undecided.length > 0
        ? { kind: 'undecided', entries: undecided }
        : resolved(input.stages, brackets);
    }
  }
};
