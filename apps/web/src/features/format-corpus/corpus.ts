import { ballotCases } from './ballots';
import { endingCases } from './endings';
import {
  corpusFormats,
  formatVariants,
  resolvedVariant,
  rulesOf,
} from './format-variants';
import { judgeCases } from './judge';
import { ratingCases } from './ratings';
import { scriptRound } from './round-script';
import { seatsOf } from './corpus-seats';
import { stableJson } from './stable-json';

/**
 * The golden corpus of today's two-sided behaviour (TAB-6.1): only what the
 * public APIs expose, as JSON, so a refactor of seats, sides and ballots can
 * prove the two-sided path observably unchanged. Each case is one file under
 * `corpus/`, named by its path.
 */
export type CorpusCase = { readonly path: string; readonly value: unknown };

const under = (
  folder: string,
  cases: readonly (readonly [string, unknown])[],
): readonly CorpusCase[] =>
  cases.map(([name, value]) => ({ path: `${folder}/${name}.json`, value }));

/** Compiled rules for every catalog format and each interruption mode it permits. */
const rulesCases = () =>
  formatVariants().map((variant) => ({
    path: `rules/${variant.format.id}.${variant.mode}.json`,
    value: resolvedVariant(variant),
  }));

/** A scripted Round per format on its canonical preset, plus one with interruptions where permitted. */
const roundCases = () =>
  corpusFormats.flatMap((format) => {
    const enabled = formatVariants().find(
      (variant) =>
        variant.format.id === format.id && variant.mode === 'enabled',
    );
    const scripts = [
      { name: 'canonical', settings: format.preset, interrupting: false },
      ...(enabled
        ? [
            {
              name: 'interruptions',
              settings: enabled.settings,
              interrupting: true,
            },
          ]
        : []),
    ];
    return scripts.map(({ name, settings, interrupting }) => {
      const rules = rulesOf({ format, mode: name, settings });
      return {
        path: `rounds/${format.id}.${name}.json`,
        value: {
          formatId: format.id,
          settings,
          seats: seatsOf(rules),
          steps: scriptRound({ rules, interrupting }),
        },
      };
    });
  });

/** Every corpus case, in a fixed order. */
export const corpusCases = (): readonly CorpusCase[] => [
  ...rulesCases(),
  ...roundCases(),
  ...under('endings', endingCases()),
  ...under('ratings', ratingCases()),
  ...under('judge', judgeCases()),
  ...under('ballots', ballotCases()),
];

/** A case's exact file text. */
export const corpusText = (value: unknown): string => stableJson(value);
