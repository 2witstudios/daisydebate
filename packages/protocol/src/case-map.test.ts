import { assert, setupRitewayBun, test } from 'riteway/bun';
import { caseMapSchema } from './case-map';

setupRitewayBun();

const warrant = {
  id: 'A1.1',
  claim: 'Free courses.',
  line: '0.10',
  kind: 'evidence',
};
const caseOf = (id: string) => ({
  thesis: { id, claim: 'The degree is losing value.', line: '0.0' },
  framework: 'More true than false on any one of three values.',
  burdens: [
    {
      id: `${id}1`,
      claim: 'Prestige is falling.',
      line: '0.5',
      warrants: [warrant],
    },
  ],
});
const valid = {
  about: {
    question: 'Is it losing value?',
    affirmative: 'Yes.',
    negative: 'No.',
  },
  cases: { affirmative: caseOf('A'), negative: caseOf('N') },
  framework: {
    dispute: 'Past baseline against alternatives.',
    contested: [
      { by: 'negative', line: '5.0', how: 'Compared with high school.' },
    ],
    ruling: 'The past baseline governs: the negative agreed at 3.16.',
    liveBurdens: ['A1'],
  },
  attacks: [
    {
      by: 'affirmative',
      line: '4.0, 6.1',
      target: 'N1',
      level: 'premise',
      kind: 'concession',
      claim: 'Still better than high school does not show no decline.',
      answeredBy: ['5.1'],
      succeeds: 'yes',
      why: 'The negative agreed the baseline is the past.',
      removes: [
        { id: 'N1.1', dependency: 'It rests on the alternative baseline.' },
      ],
    },
  ],
  concessions: [
    {
      by: 'negative',
      line: '3.16',
      quote: 'Yeah, absolutely.',
      limits: 'Accounting for inflation.',
      bearsOn: 'N1',
      againstOwnCase: true,
    },
  ],
  coherence: {
    affirmative: [],
    negative: ['Agreed the past baseline, argued alternatives.'],
  },
  standing: { affirmative: ['A', 'A1'], negative: ['N'] },
};

test('a full case map', () => {
  assert({
    given:
      'both cases, the framework ruling, an attack with what it removes, a concession and what stands',
    should: 'accept it',
    actual: caseMapSchema.safeParse(valid).success,
    expected: true,
  });
});

test('refusals', () => {
  const refused = [
    { ...valid, verdict: 'affirmative' },
    { ...valid, attacks: [{ ...valid.attacks[0], succeeds: 'maybe' }] },
    { ...valid, attacks: [{ ...valid.attacks[0], level: 'vibes' }] },
    {
      ...valid,
      concessions: [{ ...valid.concessions[0], againstOwnCase: 'yes' }],
    },
    { ...valid, about: { ...valid.about, question: 'x'.repeat(601) } },
    { ...valid, standing: { affirmative: ['A'] } },
    { ...valid, attacks: Array.from({ length: 49 }, () => valid.attacks[0]) },
  ].map((value) => caseMapSchema.safeParse(value).success);
  assert({
    given:
      'an unknown field, an unknown outcome or level, a non-boolean, an overlong question, a missing side and too many attacks',
    should: 'refuse each',
    actual: refused,
    expected: refused.map(() => false),
  });
});
