import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  releaseCommandCatalogue,
  releaseCommandRefusals,
  releaseCommandSchema,
  resultCommandCatalogue,
  resultCommandEnvelopeSchema,
  resultCommandRefusals,
  resultCommandSchema,
} from './result-command';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const entries = [
  { entryId: id('a'), won: true, rank: null, ballotsWon: 2 },
  { entryId: id('b'), won: false, rank: null, ballotsWon: 1 },
];

const validResults = {
  'record-administrative-result': {
    type: 'record-administrative-result',
    fixtureId: id('f'),
    administrativeReason: 'double_loss',
    reason: 'Both teams late',
    entries: [
      { entryId: id('a'), won: false, rank: null, ballotsWon: null },
      { entryId: id('b'), won: false, rank: null, ballotsWon: null },
    ],
  },
  'correct-result': {
    type: 'correct-result',
    fixtureId: id('f'),
    supersedesResultId: id('r'),
    reason: 'Ballot entered against the wrong side',
    entries,
  },
  'certify-result': { type: 'certify-result', resultId: id('r') },
  'certify-event': { type: 'certify-event', eventId: id('v') },
  'resolve-screening-hold': {
    type: 'resolve-screening-hold',
    ballotId: id('b'),
    release: { kind: 'original' },
  },
} as const;

const validReleases = {
  'open-audience': {
    type: 'open-audience',
    eventId: id('v'),
    tabRounds: { kind: 'one', tabRoundId: id('t') },
    thing: 'decision',
    audience: 'competitors',
  },
  'release-resolution': { type: 'release-resolution', tabRoundId: id('t') },
} as const;

test('result commands', () => {
  for (const [type, command] of Object.entries(validResults))
    assert({
      given: `a valid ${type}`,
      should: 'parse to itself',
      actual: parseOutcome(resultCommandSchema, command),
      expected: { data: command },
    });

  const redacted = {
    ...validResults['resolve-screening-hold'],
    release: {
      kind: 'redacted',
      text: { reason: 'The [redacted] argument won.' },
    },
  };
  assert({
    given: 'a screening hold resolved with a redacted text',
    should: 'parse to itself',
    actual: parseOutcome(resultCommandSchema, redacted),
    expected: { data: redacted },
  });

  const envelope = {
    version: 1,
    commandId: id('c'),
    expected: { fixture: 4 },
    command: validResults['correct-result'],
  };
  assert({
    given: 'an envelope carrying a correction',
    should: 'parse to itself',
    actual: parseOutcome(resultCommandEnvelopeSchema, envelope),
    expected: { data: envelope },
  });

  assert({
    given: 'an administrative result of kind forfeit',
    should: 'reject it (a forfeit is recorded by officiating)',
    actual: parseOutcome(resultCommandSchema, {
      ...validResults['record-administrative-result'],
      administrativeReason: 'forfeit',
    }).issues,
    expected: ['administrativeReason'],
  });

  assert({
    given: 'a correction with no outcome',
    should: 'reject the entries',
    actual: parseOutcome(resultCommandSchema, {
      ...validResults['correct-result'],
      entries: [],
    }).issues,
    expected: ['entries'],
  });

  assert({
    given: 'a correction naming one entry twice',
    should: 'reject the entries',
    actual: parseOutcome(resultCommandSchema, {
      ...validResults['correct-result'],
      entries: [entries[0], entries[0]],
    }).issues,
    expected: ['entries'],
  });

  assert({
    given: 'an outcome with a rank of zero',
    should: 'reject the rank',
    actual: parseOutcome(resultCommandSchema, {
      ...validResults['correct-result'],
      entries: [{ ...entries[0], rank: 0 }],
    }).issues,
    expected: ['entries.0.rank'],
  });

  assert({
    given: 'a correction without the result it supersedes',
    should: 'reject it',
    actual: parseOutcome(resultCommandSchema, {
      type: 'correct-result',
      fixtureId: id('f'),
      reason: 'x',
      entries,
    }).issues,
    expected: ['supersedesResultId'],
  });

  assert({
    given: 'a screening hold released in an unknown way',
    should: 'reject the release',
    actual: parseOutcome(resultCommandSchema, {
      ...validResults['resolve-screening-hold'],
      release: { kind: 'rewritten' },
    }).issues,
    expected: ['release.kind'],
  });

  assert({
    given: 'a certify-result with an unknown key',
    should: 'reject it (strict)',
    actual: parseOutcome(resultCommandSchema, {
      ...validResults['certify-result'],
      edit: { won: true },
    }).issues,
    expected: ['(root)'],
  });
});

test('release commands', () => {
  for (const [type, command] of Object.entries(validReleases))
    assert({
      given: `a valid ${type}`,
      should: 'parse to itself',
      actual: parseOutcome(releaseCommandSchema, command),
      expected: { data: command },
    });

  const everyRound = {
    ...validReleases['open-audience'],
    tabRounds: { kind: 'all' },
  };
  assert({
    given: 'an audience opened for every tab round',
    should: 'parse to itself',
    actual: parseOutcome(releaseCommandSchema, everyRound),
    expected: { data: everyRound },
  });

  assert({
    given: 'an audience that is not in the vocabulary',
    should: 'reject the audience',
    actual: parseOutcome(releaseCommandSchema, {
      ...validReleases['open-audience'],
      audience: 'officials',
    }).issues,
    expected: ['audience'],
  });

  assert({
    given: 'a thing that is not in the vocabulary',
    should: 'reject the thing',
    actual: parseOutcome(releaseCommandSchema, {
      ...validReleases['open-audience'],
      thing: 'transcript',
    }).issues,
    expected: ['thing'],
  });

  assert({
    given: 'a release-resolution with an unknown key',
    should: 'reject it (strict)',
    actual: parseOutcome(releaseCommandSchema, {
      ...validReleases['release-resolution'],
      text: 'This house would',
    }).issues,
    expected: ['(root)'],
  });
});

const coversUnion = (
  catalogue: Readonly<
    Record<
      string,
      {
        readonly refusals: readonly string[];
        readonly gate: readonly string[];
        readonly history: string;
      }
    >
  >,
  refusals: readonly string[],
) =>
  Object.values(catalogue).every(
    (definition) =>
      definition.gate.length > 0 &&
      definition.history === 'entry' &&
      definition.refusals.every((refusal) => refusals.includes(refusal)),
  ) &&
  refusals.every((refusal) =>
    Object.values(catalogue).some((definition) =>
      definition.refusals.includes(refusal),
    ),
  );

test('result and release catalogues', () => {
  assert({
    given: 'the result catalogue',
    should: 'define every result command',
    actual: Object.keys(resultCommandCatalogue).sort(),
    expected: Object.keys(validResults).sort(),
  });
  assert({
    given: 'the release catalogue',
    should: 'define every release command',
    actual: Object.keys(releaseCommandCatalogue).sort(),
    expected: Object.keys(validReleases).sort(),
  });
  assert({
    given: 'each catalogue and its group refusal list',
    should: 'name a gate, a history entry and only listed refusals, each used',
    actual: [
      coversUnion(resultCommandCatalogue, resultCommandRefusals),
      coversUnion(releaseCommandCatalogue, releaseCommandRefusals),
    ],
    expected: [true, true],
  });
});
