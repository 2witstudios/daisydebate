import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  ReleaseCommand,
  ResultCommand,
} from '@daisy/protocol/lobby/result-command';
import type { ResultRow } from './fixture';
import {
  decideCertification,
  decideFixtureResult,
  decideOpenAudience,
  decideReleaseResolution,
  decideScreeningHold,
  type CertificationFacts,
  type FixtureResultFacts,
  type OpenAudienceFacts,
  type ReleaseResolutionFacts,
} from './result';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const fixtureId = id('f');
const now = '2026-11-14T10:00:00.000Z';
const original: ResultRow = {
  id: id('q'),
  kind: 'decided',
  administrativeReason: null,
  roundId: id('d'),
  supersedesResultId: null,
  recordedAt: '2026-11-14T09:00:00.000Z',
};

const published: FixtureResultFacts = {
  commandId: id('c'),
  now,
  mintedResultId: id('r'),
  fixture: {
    id: fixtureId,
    lobbyId: id('l'),
    eventId: id('v'),
    tabRoundId: id('t'),
    kind: 'pairing',
    status: 'published',
    roomId: id('o'),
    version: 2,
  },
  entries: [
    { entryId: id('a'), side: 'affirmative', schoolOrganizationId: null },
    { entryId: id('b'), side: 'negative', schoolOrganizationId: null },
  ],
  members: [],
  panel: [],
  round: { id: id('d'), status: 'completed' },
  ballots: [],
  results: [],
};
const decided: FixtureResultFacts = { ...published, results: [original] };

const outcome = [
  { entryId: id('a'), won: false, rank: null, ballotsWon: 1 },
  { entryId: id('b'), won: true, rank: null, ballotsWon: 2 },
];
const administrative: Extract<
  ResultCommand,
  { type: 'record-administrative-result' }
> = {
  type: 'record-administrative-result',
  fixtureId,
  administrativeReason: 'ruling',
  reason: 'Evidence violation',
  entries: outcome,
};
const correct: Extract<ResultCommand, { type: 'correct-result' }> = {
  type: 'correct-result',
  fixtureId,
  supersedesResultId: id('q'),
  reason: 'Ballot entered against the wrong side',
  entries: outcome,
};

const refusalOf = (decision: { kind: string; refusal?: string }) =>
  decision.kind === 'refused' ? decision.refusal : 'accepted';

test('an administrative result', () => {
  assert({
    given: 'an administrative result by the fixture state',
    should: 'be recorded once, on a published fixture without one',
    actual: [
      refusalOf(decideFixtureResult(published, administrative)),
      refusalOf(decideFixtureResult(decided, administrative)),
      refusalOf(
        decideFixtureResult(
          {
            ...published,
            fixture: { ...published.fixture, status: 'draft', roomId: null },
          },
          administrative,
        ),
      ),
      refusalOf(
        decideFixtureResult(
          {
            ...published,
            fixture: { ...published.fixture, status: 'withdrawn' },
          },
          administrative,
        ),
      ),
    ],
    expected: [
      'accepted',
      'result-exists',
      'fixture-unpublished',
      'fixture-withdrawn',
    ],
  });
  assert({
    given: 'an outcome that leaves out an entry, or a blank reason',
    should: 'refuse it by name',
    actual: [
      refusalOf(
        decideFixtureResult(published, {
          ...administrative,
          entries: [outcome[0]!],
        }),
      ),
      refusalOf(
        decideFixtureResult(published, { ...administrative, reason: ' ' }),
      ),
    ],
    expected: ['outcome-mismatch', 'reason-required'],
  });
});

test('a correction is a new result naming the one it supersedes', () => {
  const decision = decideFixtureResult(decided, correct);
  assert({
    given: 'a correction of the fixture result',
    should:
      'insert exactly one result row naming the superseded result, and its entries',
    actual: decision,
    expected: {
      kind: 'accepted',
      aggregate: { kind: 'result', id: id('r') },
      resultingVersion: 1,
      writes: [
        {
          table: 'results',
          op: 'insert',
          row: {
            id: id('r'),
            lobbyId: id('l'),
            eventId: id('v'),
            tabRoundId: id('t'),
            fixtureId,
            kind: 'decided',
            administrativeReason: null,
            roundId: id('d'),
            supersedesResultId: id('q'),
            correctionReason: 'Ballot entered against the wrong side',
            commandId: id('c'),
            recordedAt: now,
          },
        },
        ...outcome.map((entry) => ({
          table: 'result_entries' as const,
          op: 'insert' as const,
          row: { resultId: id('r'), fixtureId, lobbyId: id('l'), ...entry },
        })),
      ],
      findings: [],
      fixtureChanges: [],
    },
  });
  const corrected: FixtureResultFacts = {
    ...decided,
    results: [
      original,
      { ...original, id: id('r'), supersedesResultId: id('q') },
    ],
  };
  assert({
    given:
      'a correction of a result that is not the fixture’s, one already superseded, or no reason',
    should: 'refuse it by name',
    actual: [
      refusalOf(
        decideFixtureResult(decided, {
          ...correct,
          supersedesResultId: id('z'),
        }),
      ),
      refusalOf(decideFixtureResult(published, correct)),
      refusalOf(decideFixtureResult(corrected, correct)),
      refusalOf(decideFixtureResult(decided, { ...correct, reason: '' })),
    ],
    expected: [
      'result-not-in-fixture',
      'result-not-in-fixture',
      'already-superseded',
      'reason-required',
    ],
  });
  assert({
    given: 'a correction of the latest result in a chain',
    should: 'be accepted',
    actual: refusalOf(
      decideFixtureResult(corrected, {
        ...correct,
        supersedesResultId: id('r'),
      }),
    ),
    expected: 'accepted',
  });
  const everyResultCommand = [
    decideFixtureResult(published, administrative),
    decideFixtureResult(decided, correct),
  ];
  assert({
    given: 'every result command',
    should:
      'only insert: no result is updated or deleted, and no draw is touched',
    actual: everyResultCommand.every(
      (outcome) =>
        outcome.kind === 'accepted' &&
        outcome.writes.every((write) => write.op === 'insert') &&
        outcome.writes.filter((write) => write.table === 'results').length ===
          1,
    ),
    expected: true,
  });
});

test('certification', () => {
  const facts: CertificationFacts = {
    commandId: id('c'),
    now,
    mintedCertificationId: id('k'),
    event: { id: id('v'), lobbyId: id('l') },
    resultsVersion: 7,
    publishedFixtureIds: [fixtureId, id('g')],
    results: [
      { ...original, fixtureId },
      { ...original, id: id('r'), supersedesResultId: id('q'), fixtureId },
      { ...original, id: id('s'), roundId: id('e'), fixtureId: id('g') },
    ],
    certifiedResultIds: [],
    screenings: [
      {
        ballotId: id('b'),
        roundId: id('e'),
        tabRoundId: id('t'),
        status: 'clear',
      },
    ],
  };
  const event: Extract<ResultCommand, { type: 'certify-event' }> = {
    type: 'certify-event',
    eventId: id('v'),
  };
  const one = (
    resultId: string,
  ): Extract<ResultCommand, { type: 'certify-result' }> => ({
    type: 'certify-result',
    resultId,
  });
  const certified = decideCertification(facts, event);
  assert({
    given: 'an event whose fixtures all have a current result',
    should: 'certify exactly the current results, never a superseded one',
    actual:
      certified.kind === 'accepted'
        ? certified.writes.flatMap((write) =>
            write.table === 'certification_results'
              ? [write.row.resultId]
              : [write.row.scope],
          )
        : certified,
    expected: ['event', id('r'), id('s')],
  });
  const held = {
    ...facts,
    screenings: [{ ...facts.screenings[0]!, status: 'held' as const }],
  };
  assert({
    given: 'each reason a certification cannot go ahead',
    should: 'refuse it by name',
    actual: [
      refusalOf(
        decideCertification(
          { ...facts, results: facts.results.slice(0, 2) },
          event,
        ),
      ),
      refusalOf(decideCertification(held, event)),
      refusalOf(
        decideCertification(
          { ...facts, certifiedResultIds: [id('r'), id('s')] },
          event,
        ),
      ),
      refusalOf(decideCertification(facts, one(id('q')))),
      refusalOf(
        decideCertification(
          { ...facts, certifiedResultIds: [id('r')] },
          one(id('r')),
        ),
      ),
      refusalOf(decideCertification(held, one(id('s')))),
      refusalOf(decideCertification(facts, one(id('s')))),
    ],
    expected: [
      'results-incomplete',
      'screening-pending',
      'already-certified',
      'already-superseded',
      'already-certified',
      'screening-pending',
      'accepted',
    ],
  });
});

test('a screening hold is settled without rewriting the ballot', () => {
  const screening = {
    ballotId: id('b'),
    roundId: id('d'),
    tabRoundId: id('t'),
  };
  const resolve = (
    kind: 'original' | 'redacted',
  ): Extract<ResultCommand, { type: 'resolve-screening-hold' }> => ({
    type: 'resolve-screening-hold',
    ballotId: id('b'),
    release:
      kind === 'original'
        ? { kind }
        : { kind, text: { reason: 'The [redacted] case' } },
  });
  const decision = decideScreeningHold(
    { now, screening: { ...screening, status: 'held' } },
    resolve('redacted'),
  );
  assert({
    given: 'a held ballot released redacted',
    should: 'write only its screening row, with the released text',
    actual: decision.kind === 'accepted' ? decision.writes : decision,
    expected: [
      {
        table: 'ballot_screenings',
        op: 'update',
        ballotId: id('b'),
        set: {
          status: 'clear',
          releasedText: { reason: 'The [redacted] case' },
          updatedAt: now,
        },
      },
    ],
  });
  assert({
    given: 'a screening that is not held',
    should:
      'refuse hold-settled when clear and screening-pending while screened',
    actual: [
      refusalOf(
        decideScreeningHold(
          { now, screening: { ...screening, status: 'clear' } },
          resolve('original'),
        ),
      ),
      refusalOf(
        decideScreeningHold(
          { now, screening: { ...screening, status: 'pending' } },
          resolve('original'),
        ),
      ),
    ],
    expected: ['hold-settled', 'screening-pending'],
  });
});

test('opening an audience', () => {
  const facts: OpenAudienceFacts = {
    commandId: id('c'),
    now,
    event: { id: id('v'), lobbyId: id('l') },
    tabRounds: [
      { id: id('t'), mintedReleaseId: id('1') },
      { id: id('u'), mintedReleaseId: id('2') },
    ],
    whens: {
      responsible_adults: 'round_close',
      competitors: 'manual',
      participants: 'manual',
      link: 'never',
      public: 'never',
    },
    releases: [
      { tabRoundId: id('t'), thing: 'reason', audience: 'responsible_adults' },
      { tabRoundId: id('u'), thing: 'reason', audience: 'responsible_adults' },
    ],
    screenings: [],
  };
  const open = (
    audience: Extract<ReleaseCommand, { type: 'open-audience' }>['audience'],
    tabRounds: Extract<
      ReleaseCommand,
      { type: 'open-audience' }
    >['tabRounds'] = { kind: 'all' },
  ): Extract<ReleaseCommand, { type: 'open-audience' }> => ({
    type: 'open-audience',
    eventId: id('v'),
    tabRounds,
    thing: 'reason',
    audience,
  });
  const opened = decideOpenAudience(facts, open('competitors'));
  assert({
    given: 'a manual audience opened for every tab round',
    should: 'insert one manual release per tab round',
    actual:
      opened.kind === 'accepted'
        ? opened.writes.map((write) =>
            write.table === 'releases'
              ? [write.row.id, write.row.tabRoundId, write.row.cause]
              : null,
          )
        : opened,
    expected: [
      [id('1'), id('t'), 'manual'],
      [id('2'), id('u'), 'manual'],
    ],
  });
  const competitorsOpen = {
    ...facts,
    releases: [
      ...facts.releases,
      {
        tabRoundId: id('t'),
        thing: 'reason',
        audience: 'competitors',
      } as const,
    ],
  };
  assert({
    given: 'each reason an audience cannot open',
    should: 'refuse it by name',
    actual: [
      refusalOf(decideOpenAudience(facts, open('responsible_adults'))),
      refusalOf(decideOpenAudience(facts, open('participants'))),
      refusalOf(
        decideOpenAudience(
          competitorsOpen,
          open('competitors', { kind: 'one', tabRoundId: id('t') }),
        ),
      ),
      refusalOf(
        decideOpenAudience(
          {
            ...facts,
            screenings: [
              {
                ballotId: id('b'),
                roundId: id('d'),
                tabRoundId: id('u'),
                status: 'pending',
              },
            ],
          },
          open('competitors'),
        ),
      ),
      refusalOf(
        decideOpenAudience(
          facts,
          open('competitors', { kind: 'one', tabRoundId: id('z') }),
        ),
      ),
    ],
    expected: [
      'not-manual',
      'audience-order',
      'already-open',
      'screening-pending',
      'not-found',
    ],
  });
});

test('releasing a resolution', () => {
  const facts: ReleaseResolutionFacts = {
    now,
    tabRound: {
      id: id('t'),
      eventId: id('v'),
      poolResolutionId: null,
      resolutionReleasedAt: null,
      version: 3,
    },
    rule: { method: 'draw', release: 'manual' },
    drawnPoolResolutionId: id('p'),
  };
  const command = { type: 'release-resolution', tabRoundId: id('t') } as const;
  const released = decideReleaseResolution(facts, command);
  assert({
    given: 'a manual drawn resolution',
    should: 'draw the wording first, then release it',
    actual: released.kind === 'accepted' ? released.writes : released,
    expected: [
      {
        table: 'tab_rounds',
        op: 'update',
        id: id('t'),
        set: {
          poolResolutionId: id('p'),
          resolutionReleasedAt: now,
          version: 4,
        },
      },
    ],
  });
  assert({
    given: 'each reason a resolution cannot be released by hand',
    should: 'refuse it by name',
    actual: [
      refusalOf(
        decideReleaseResolution(
          {
            ...facts,
            tabRound: { ...facts.tabRound, resolutionReleasedAt: now },
          },
          command,
        ),
      ),
      refusalOf(
        decideReleaseResolution(
          { ...facts, rule: { method: 'fixed', release: 'with_posting' } },
          command,
        ),
      ),
      refusalOf(
        decideReleaseResolution(
          { ...facts, rule: { method: 'fixed', release: 'manual' } },
          command,
        ),
      ),
      refusalOf(
        decideReleaseResolution(
          { ...facts, drawnPoolResolutionId: null },
          command,
        ),
      ),
    ],
    expected: [
      'already-released',
      'not-manual',
      'resolution-unset',
      'resolution-unset',
    ],
  });
});
