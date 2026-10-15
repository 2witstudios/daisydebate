import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint, type LaunchedRound } from '@daisy/protocol';
import { readableCheckpoint, roundViewFor } from './round-view-projection';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const seat = (
  c: string,
  role: 'affirmative' | 'negative' | 'judge',
  kind: 'human' | 'bot' = 'human',
) => ({
  id: id(c),
  actorId: id(c),
  kind,
  label: `${role} ${c}`,
  role,
  slot: 0,
});
const aff = { ...seat('a', 'affirmative'), actorId: id('b') };
const neg = { ...seat('c', 'negative'), actorId: id('d') };
const judge = { ...seat('e', 'judge'), actorId: id('f'), label: 'Riley Judge' };
const host = id('h');
const round = {
  id: id('r'),
  roomId: id('m'),
  version: 1,
  status: 'active',
  competitionType: 'casual',
  topic: 'A topic',
  visibility: 'public',
  hostActorId: host,
  participants: [aff, neg, judge],
  startedAt: null,
  completedAt: null,
  outcome: null,
  checkpoint: emptyRuntimeCheckpoint,
  segments: [],
} as unknown as LaunchedRound;

/** Every judge identity a serialized view could leak. */
const leaks = (value: unknown) =>
  ['Riley', judge.id, judge.actorId, host].filter((secret) =>
    JSON.stringify(value).includes(secret),
  );

describe('roundViewFor', () => {
  test('debaters and spectators', () => {
    assert({
      given:
        'the Round read by a debater, a spectator and an anonymous visitor',
      should: 'carry no judge name, judge ids or host actor for any of them',
      actual: [aff.actorId, id('z'), null].map((viewer) =>
        leaks(roundViewFor(round, viewer)),
      ),
      expected: [[], [], []],
    });
    assert({
      given: 'a debater’s view',
      should: 'show the judge seat as filled and anonymous, debaters named',
      actual: roundViewFor(round, aff.actorId).participants,
      expected: [
        aff,
        neg,
        { role: 'judge', kind: 'human', slot: 0, anonymous: true },
      ],
    });
  });

  test('the judge and the host', () => {
    assert({
      given: 'the Round read by its judge and by its host',
      should: 'name the judge to both and still never send the host actor',
      actual: [judge.actorId, host].map((viewer) => {
        const view = roundViewFor(round, viewer);
        return [view.participants[2], 'hostActorId' in view];
      }),
      expected: [
        [judge, false],
        [judge, false],
      ],
    });
  });

  test('an AI judge', () => {
    const bot = { ...judge, kind: 'bot' as const, label: 'AI judge' };
    assert({
      given: 'a bot in the judge seat, read by a debater',
      should: 'keep the bot seat as it is: no person to protect',
      actual: roundViewFor(
        { ...round, participants: [aff, neg, bot] },
        aff.actorId,
      ).participants[2],
      expected: bot,
    });
  });
});

describe('readableCheckpoint', () => {
  test('a stored checkpoint that no longer parses', () => {
    assert({
      given: 'a valid checkpoint, a malformed one and none',
      should: 'keep the valid one and read the others as no live position',
      actual: [
        readableCheckpoint(emptyRuntimeCheckpoint),
        readableCheckpoint({ version: 1, prep_consumed_ms: 'lots' }),
        readableCheckpoint(null),
      ],
      expected: [emptyRuntimeCheckpoint, null, null],
    });
  });
});
