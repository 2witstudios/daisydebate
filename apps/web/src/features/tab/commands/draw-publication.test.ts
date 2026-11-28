import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideDraw, type DrawFacts, type DrawFixtureFacts } from './draw';
import { tabEngine } from '../operations/tab-engine';
import { engineSettings } from '../operations/engine-settings';
setupRitewayBun();
const id = (word: string) => word.padEnd(24, '0');
const a = id('entrya'),
  b = id('entryb'),
  c = id('entryc'),
  judge = id('judge'),
  person = id('judgeperson'),
  fixtureId = id('fixture');
const settings = engineSettings([], [], {
  'room.timing': { preRoundPrepMs: 0, inRoundPrepMsPerSide: 0, countdownMs: 0 },
  'room.floor': { pointsOfInformation: null, yielding: null },
});
const fixture: DrawFixtureFacts = {
  id: fixtureId,
  kind: 'pairing',
  status: 'draft',
  version: 1,
  roomId: null,
  state: null,
  entries: [a, b].map((entryId, position) => ({
    entryId,
    position,
    side: position === 0 ? 'aff' : 'neg',
    members: [id(`person${position}`)],
  })),
  judges: [{ tournamentJudgeId: judge, person, chair: true }],
};
const facts = (held: DrawFixtureFacts = fixture): DrawFacts => ({
  commandId: id('command'),
  now: '2027-01-01T00:00:00.000Z',
  freshIds: [id('room')],
  event: {
    id: id('event'),
    lobbyId: id('lobby'),
    name: 'Actual draft',
    formatId: 'freestyle',
    formatVersion: 1,
    templateId: null,
    ballotDefinitionId: null,
    ballotDefinitionVersion: null,
    format: { outcome: 'winner', sides: 2 },
    sideNames: ['aff', 'neg'],
  },
  tabRound: {
    id: id('round'),
    number: 1,
    name: 'Round 1',
    stage: { kind: 'preliminary' },
    timing: 'live',
    timeSlot: { id: id('slot'), version: 1 },
  },
  versions: [
    {
      id: id('draw'),
      version: 1,
      status: 'draft',
      basedOnDrawId: null,
      inputs: {
        stage: { kind: 'preliminary' },
        breakResultIds: [],
        engine: null,
        settingsDigest: 'same',
        broken: [],
        overrides: [],
      },
      fixtureIds: [fixtureId],
    },
  ],
  fixtures: [held],
  settings: { kind: 'resolved', values: settings, digest: 'same' },
  engine: {
    entries: [a, b].map((entry, index) => ({
      id: entry,
      members: [id(`person${index}`)],
      protection: [],
      division: null,
      status: 'active',
      breakEligible: true,
    })),
    history: { fixtures: [], results: [] },
    ratings: null,
    judges: [
      {
        id: judge,
        person,
        protection: [],
        events: null,
        conflicts: [],
        strikes: [],
        judged: [],
        tabRoundsJudged: 0,
        outstandingBallots: 0,
        chair: true,
        available: true,
      },
    ],
    commitments: [],
  },
  breakChoicesPending: false,
  feederResultsComplete: true,
  breakResultIds: [],
  slotElsewhere: [],
  releasesAtOnce: [],
});
const publish = {
  type: 'publish-draw' as const,
  drawId: id('draw'),
  overrides: [],
};
const result = (value: DrawFacts) => {
  const decision = decideDraw(tabEngine)(value, publish);
  return decision.kind === 'refused' ? decision.refusal : 'accepted';
};
test('publication assesses the actual current draft instead of trusting cached broken rules', () => {
  const three = facts({
    ...fixture,
    entries: [
      ...fixture.entries,
      { entryId: c, position: 2, side: 'extra', members: [id('personc')] },
    ],
  });
  const missing = facts({ ...fixture, entries: [fixture.entries[0]!] });
  const duplicate = facts({
    ...fixture,
    entries: [
      fixture.entries[0]!,
      { ...fixture.entries[0]!, position: 1, side: 'neg' },
    ],
  });
  const wrongSide = facts({
    ...fixture,
    entries: fixture.entries.map((entry) => ({ ...entry, side: 'other' })),
  });
  const gap = facts({
    ...fixture,
    entries: fixture.entries.map((entry, index) => ({
      ...entry,
      position: index + 1,
    })),
  });
  const withdrawn = facts({ ...fixture, status: 'withdrawn' });
  const missingChild = { ...facts(), fixtures: [] };
  const repeatedLink = {
    ...facts(),
    versions: facts().versions.map((draw) => ({
      ...draw,
      fixtureIds: [fixtureId, fixtureId],
    })),
  };
  assert({
    given:
      'malformed tuples, repeated or missing entries/children and stale draft statuses with cached broken=[]',
    should:
      'refuse all structural failures before producing any Room or release writes',
    actual: [
      three,
      missing,
      duplicate,
      wrongSide,
      gap,
      withdrawn,
      missingChild,
      repeatedLink,
    ].map(result),
    expected: Array(8).fill('draw-unresolved'),
  });
  const override = decideDraw(tabEngine)(three, {
    ...publish,
    overrides: [
      { key: 'pairing.rematch', reason: 'A reason cannot repair structure' },
    ],
  });
  assert({
    given: 'a pairing-rule override on a structurally invalid draft',
    should: 'refuse structural invalidity without writes',
    actual: override.kind === 'refused' ? override.refusal : 'accepted',
    expected: 'draw-unresolved',
  });
});
test('publication requires the current complete accepted panel and a chair', () => {
  const empty = facts({ ...fixture, judges: [] });
  const unknown = facts({
    ...fixture,
    judges: [{ ...fixture.judges[0]!, tournamentJudgeId: id('unknown') }],
  });
  const unchaired = facts({
    ...fixture,
    judges: [{ ...fixture.judges[0]!, chair: false }],
  });
  const mismatched = facts({
    ...fixture,
    judges: [{ ...fixture.judges[0]!, person: id('different') }],
  });
  assert({
    given:
      'a short panel, unavailable registration, absent chair or mismatched panel identity',
    should:
      'require real complete panel facts, separately from overridable pairing rules',
    actual: [empty, unknown, unchaired, mismatched].map(result),
    expected: [
      'judges-insufficient',
      'judges-insufficient',
      'draw-unresolved',
      'draw-unresolved',
    ],
  });
  assert({
    given:
      'the same actual two-sided draft with its complete accepted one-judge panel',
    should: 'remain publishable through the real merged engine assessment',
    actual: result(facts()),
    expected: 'accepted',
  });
});
test('current rule failures are re-assessed even when the stored draft reports no broken rules', () => {
  const current = facts();
  const unavailable = {
    ...current,
    engine: {
      ...current.engine,
      judges: current.engine.judges.map((judge) => ({
        ...judge,
        available: false,
      })),
    },
  };
  const overridden = decideDraw(tabEngine)(unavailable, {
    ...publish,
    overrides: [
      {
        key: 'judging.availability',
        reason: 'Judge confirmed availability directly',
      },
    ],
  });
  assert({
    given:
      'an accepted judge whose actual availability now breaks a rule, with cached broken=[]',
    should:
      'require and record the current rule override independently of structural validity',
    actual: [
      result(unavailable),
      overridden.kind,
      overridden.kind === 'accepted'
        ? overridden.writes.flatMap((write) =>
            write.table === 'draws' && write.op === 'update'
              ? write.set.inputs.broken
              : [],
          )
        : [],
    ],
    expected: ['rule-broken', 'accepted', ['judging.availability']],
  });
});
test('a bye has no panel and creates no Room', () => {
  const base = facts({
    ...fixture,
    kind: 'bye',
    entries: [{ ...fixture.entries[0]!, side: null }],
    judges: [],
  });
  const current = {
    ...base,
    engine: { ...base.engine, entries: base.engine.entries.slice(0, 1) },
  };
  const decision = decideDraw(tabEngine)(current, publish);
  assert({
    given: 'a real assessed one-entry bye with no panel',
    should: 'publish without inventing a judge or Room',
    actual: [
      decision.kind,
      decision.kind === 'accepted'
        ? decision.writes.some((write) => write.table === 'rooms')
        : true,
    ],
    expected: ['accepted', false],
  });
});
