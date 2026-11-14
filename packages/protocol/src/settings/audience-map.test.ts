import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  releaseAudiences,
  releaseWhenSchema,
  type ReleaseWhen,
} from '../release-audience';
import {
  audienceMapSchema,
  participantAudienceMapSchema,
} from './audience-map';
import { settingsCatalogue } from './catalogue';

setupRitewayBun();

const whens = releaseWhenSchema.options;
type Map = Record<(typeof releaseAudiences)[number], ReleaseWhen>;
/** Every map: seven whens for each of five audiences. */
const maps: Map[] = releaseAudiences.reduce<Partial<Map>[]>(
  (partial, audience) =>
    partial.flatMap((map) =>
      whens.map((when) => ({ ...map, [audience]: when })),
    ),
  [{}],
) as Map[];
const accepted = maps.filter((map) => audienceMapSchema.safeParse(map).success);
/** The moment a when falls on; a manual opening has no fixed moment. */
const moment: Record<Exclude<ReleaseWhen, 'manual'>, number> = {
  at_once: 0,
  round_close: 1,
  prelims_end: 2,
  break: 3,
  certified: 4,
  never: Infinity,
};
const pairs = releaseAudiences.flatMap((narrower, index) =>
  releaseAudiences.slice(index + 1).map((wider) => [narrower, wider] as const),
);
const map = (...values: ReleaseWhen[]) =>
  Object.fromEntries(
    releaseAudiences.map((audience, index) => [audience, values[index]]),
  );

describe('an audience map', () => {
  test('never opens a wider audience before a narrower one', () => {
    assert({
      given: 'every one of the 16,807 maps the schema accepts or refuses',
      should:
        'accept none in which a wider audience’s moment comes before a narrower one’s',
      actual: accepted.filter((candidate) =>
        pairs.some(([narrower, wider]) => {
          const [first, second] = [candidate[narrower], candidate[wider]];
          return (
            first !== 'manual' &&
            second !== 'manual' &&
            moment[second] < moment[first]
          );
        }),
      ).length,
      expected: 0,
    });
    assert({
      given: 'the maps with no manual opening',
      should:
        'be accepted exactly when their moments never decrease from narrowest to widest',
      actual: maps
        .filter((candidate) => !Object.values(candidate).includes('manual'))
        .filter(
          (candidate) =>
            audienceMapSchema.safeParse(candidate).success !==
            pairs.every(
              ([narrower, wider]) =>
                moment[candidate[narrower] as 'never'] <=
                moment[candidate[wider] as 'never'],
            ),
        ).length,
      expected: 0,
    });
  });
  test('lets a narrower audience open by hand only when no wider one has a fixed moment', () => {
    assert({
      given: 'every accepted map',
      should:
        'have, beyond a manual audience, only manual or never; and never a manual audience wider than one that never opens',
      actual: accepted.filter((candidate) =>
        pairs.some(([narrower, wider]) => {
          const [first, second] = [candidate[narrower], candidate[wider]];
          return (
            (first === 'manual' && second !== 'manual' && second !== 'never') ||
            (second === 'manual' && first === 'never')
          );
        }),
      ).length,
      expected: 0,
    });
    assert({
      given:
        'adults at round close with everyone wider by hand, and competitors by hand with participants at the break',
      should: 'accept the first and refuse the second',
      actual: [
        parseOutcome(
          audienceMapSchema,
          map('round_close', 'manual', 'manual', 'never', 'never'),
        ),
        parseOutcome(
          audienceMapSchema,
          map('round_close', 'manual', 'break', 'never', 'never'),
        ),
        parseOutcome(
          audienceMapSchema,
          map('at_once', 'at_once', 'at_once', 'at_once'),
        ),
        parseOutcome(audienceMapSchema, {
          ...map('at_once', 'at_once', 'at_once', 'never', 'never'),
          officials: 'at_once',
        }),
      ],
      expected: [
        { data: map('round_close', 'manual', 'manual', 'never', 'never') },
        { issues: ['(root)'] },
        { issues: ['public'] },
        { issues: ['(root)'] },
      ],
    });
  });
  test('never opens scores, reasons or feedback past participants', () => {
    assert({
      given: 'every map the capped schema accepts',
      should:
        'be an accepted map with link and public never, and every such map',
      actual: maps
        .filter(
          (candidate) =>
            participantAudienceMapSchema.safeParse(candidate).success,
        )
        .map((candidate) => JSON.stringify(candidate)),
      expected: accepted
        .filter(
          (candidate) =>
            candidate.link === 'never' && candidate.public === 'never',
        )
        .map((candidate) => JSON.stringify(candidate)),
    });
    assert({
      given: 'the audience keys',
      should:
        'cap scores, reasons and feedback and leave posting, decision and video open to any audience',
      actual: (
        [
          'posting',
          'decision',
          'scores',
          'reason',
          'feedback',
          'video',
        ] as const
      ).map(
        (thing) =>
          settingsCatalogue[`audience.${thing}`].value.safeParse(
            map('at_once', 'at_once', 'at_once', 'at_once', 'at_once'),
          ).success,
      ),
      expected: [true, true, false, false, false, true],
    });
  });
});
