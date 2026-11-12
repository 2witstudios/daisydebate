import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialSpeakerState,
  nextSpeakerState,
  retryPauseMs,
  type DutyEvent,
  type DutyRules,
  type SpeakerState,
} from './duty';

setupRitewayBun();

const speech: DutyRules = { crossEx: false, asks: false, maxAttempts: 2 };
const asker: DutyRules = { crossEx: true, asks: true, maxAttempts: 2 };
const respondent: DutyRules = { crossEx: true, asks: false, maxAttempts: 2 };
/** Applies events in order and returns the last state with every effect raised. */
const after = (rules: DutyRules, ...events: DutyEvent[]) => {
  let state: SpeakerState = initialSpeakerState(rules);
  const effects: string[] = [];
  for (const event of events) {
    const step = nextSpeakerState(state, event, rules);
    state = step.state;
    effects.push(...step.effects);
  }
  return { duty: state.duty, midTurn: state.midTurn, effects };
};
const woke: DutyEvent = { type: 'woke' };
const turnEnded = (spokeUntilMs: number, spokeForMs = 800): DutyEvent => ({
  type: 'peer-turn-ended',
  peer: 'p',
  spokeUntilMs,
  spokeForMs,
});
const spoke = (audible: boolean, bought = true): DutyEvent => ({
  type: 'peer-spoke',
  peer: 'p',
  audible,
  bought,
});
const failed: DutyEvent = { type: 'failed', unusable: false };
const resumed: DutyEvent = { type: 'pause-ended' };

describe('a speech', () => {
  test('is owed once and over when delivered', () => {
    assert({
      given: 'a speech claim woken, delivered and woken again',
      should: 'speak once and then owe nothing ever again',
      actual: after(speech, woke, { type: 'delivered' }, woke),
      expected: {
        duty: { status: 'over' },
        midTurn: [],
        effects: ['start', 'drop'],
      },
    });
  });
  test('keeps its answer through a refusal and spends no attempt', () => {
    assert({
      given: 'a refusal that can clear',
      should: 'stay owed with no attempt spent and wake again soon',
      actual: after(speech, woke, {
        type: 'deferred',
        authorityChanged: true,
      }),
      expected: {
        duty: {
          status: 'owed',
          to: { kind: 'opening' },
          attempts: 0,
          setbacks: 1,
          paused: true,
        },
        midTurn: [],
        effects: ['start', 'retry-soon'],
      },
    });
  });
  test('ends after its attempts are spent, and at a final refusal', () => {
    assert({
      given: 'two failed attempts',
      should: 'retry once, then be over',
      actual: after(speech, woke, failed, resumed, woke, failed).duty,
      expected: { status: 'over' },
    });
    assert({
      given: 'a refusal that cannot clear',
      should: 'be over',
      actual: after(speech, woke, { type: 'refused-for-good' }).duty,
      expected: { status: 'over' },
    });
  });
  test('ignores its peers', () => {
    assert({
      given: 'peer activity during a speech',
      should: 'change nothing',
      actual: after(speech, woke, spoke(true), turnEnded(5)),
      expected: {
        duty: {
          status: 'speaking',
          to: { kind: 'opening' },
          attempts: 0,
          setbacks: 0,
        },
        midTurn: [],
        effects: ['start'],
      },
    });
  });
});

describe('a pause after a setback', () => {
  const deferred: DutyEvent = { type: 'deferred', authorityChanged: false };
  const pauseOf = (...events: DutyEvent[]) =>
    retryPauseMs(after(speech, ...events).duty);
  test('holds its own turn back, for longer each time in a row', () => {
    assert({
      given: 'a paused turn woken by a pulse before its pause is over',
      should: 'start nothing',
      actual: after(speech, woke, deferred, woke).effects,
      expected: ['start', 'retry-soon'],
    });
    assert({
      given: 'one, two and six setbacks in a row, each after its pause ended',
      should: 'pause 200 ms, then 400 ms, and never more than 3 s',
      actual: [
        pauseOf(woke, deferred),
        pauseOf(woke, deferred, { type: 'pause-ended' }, woke, deferred),
        pauseOf(
          ...Array.from({ length: 6 }, () => [
            { type: 'pause-ended' } as const,
            woke,
            deferred,
          ]).flat(),
        ),
      ],
      expected: [200, 400, 3000],
    });
    assert({
      given: 'a setback, a phrase said, then another setback',
      should: 'start its pauses short again',
      actual: pauseOf(
        woke,
        deferred,
        { type: 'pause-ended' },
        woke,
        { type: 'phrase-said' },
        deferred,
      ),
      expected: 200,
    });
  });
  test('never holds back the turn that replaces it', () => {
    assert({
      given:
        'the asking seat’s opening paused by a refusal, then a peer turn ending, then a pulse',
      should:
        'start the answer to that peer at once, with nothing carried over',
      actual: after(asker, woke, deferred, turnEnded(7), woke),
      expected: {
        duty: {
          status: 'speaking',
          to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 7 },
          attempts: 0,
          setbacks: 0,
        },
        midTurn: [],
        effects: ['start', 'retry-soon', 'drop', 'start'],
      },
    });
  });
});

describe('a cross-examination', () => {
  test('the asking seat opens; the respondent waits for a question to end', () => {
    assert({
      given: 'each seat when the segment opens',
      should: 'owe the opening only from the asking seat',
      actual: [
        initialSpeakerState(asker).duty,
        initialSpeakerState(respondent).duty,
      ],
      expected: [
        {
          status: 'owed',
          to: { kind: 'opening' },
          attempts: 0,
          setbacks: 0,
          paused: false,
        },
        { status: 'waiting', unanswered: false, yielded: null },
      ],
    });
  });
  test('a peer who speaks while the bot is not audible throws nothing away', () => {
    assert({
      given: 'a peer starting to speak while the answer is being prepared',
      should: 'keep the turn and mark that peer mid-turn',
      actual: after(respondent, turnEnded(1), woke, spoke(false)),
      expected: {
        duty: {
          status: 'speaking',
          to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 1 },
          attempts: 0,
          setbacks: 0,
        },
        midTurn: ['p'],
        effects: ['drop', 'start'],
      },
    });
  });
  test('a peer who resumes before anything was bought stands the turn down', () => {
    assert({
      given:
        'a peer starting to speak again while the turn still waits for their line',
      should:
        'stop the turn with nothing bought and wait for their turn to end',
      actual: after(respondent, turnEnded(1), woke, spoke(false, false)),
      expected: {
        duty: {
          status: 'waiting',
          unanswered: false,
          yielded: {
            kind: 'turn',
            to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 1 },
            attempts: 0,
            setbacks: 0,
          },
        },
        midTurn: ['p'],
        effects: ['drop', 'start', 'restart'],
      },
    });
  });
  test('a peer talking over audible bot audio cuts it, and their turn ending is owed', () => {
    const cut = after(asker, woke, spoke(true));
    assert({
      given: 'a peer talking over the bot',
      should: 'cut the turn and wait for that peer',
      actual: cut,
      expected: {
        duty: {
          status: 'waiting',
          unanswered: false,
          yielded: { kind: 'audio', peer: 'p' },
        },
        midTurn: ['p'],
        effects: ['start', 'cut', 'drop'],
      },
    });
    assert({
      given: 'that peer’s turn then ending',
      should: 'owe an answer to it with fresh attempts and nobody mid-turn',
      actual: after(asker, woke, spoke(true), turnEnded(9)),
      expected: {
        duty: {
          status: 'owed',
          to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 9 },
          attempts: 0,
          setbacks: 0,
          paused: false,
        },
        midTurn: [],
        effects: ['start', 'cut', 'drop', 'drop'],
      },
    });
  });
  test('a newer peer turn replaces the one being answered', () => {
    assert({
      given: 'a peer turn ending while an earlier one is being answered',
      should: 'restart for the newer turn',
      actual: after(respondent, turnEnded(1), woke, turnEnded(2)),
      expected: {
        duty: {
          status: 'owed',
          to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 2 },
          attempts: 0,
          setbacks: 0,
          paused: false,
        },
        midTurn: [],
        effects: ['drop', 'start', 'restart'],
      },
    });
  });
  test('a turn that was spoken earlier but ends later replaces nothing', () => {
    const late: DutyEvent = {
      type: 'peer-turn-ended',
      peer: 'q',
      spokeUntilMs: 1,
      spokeForMs: 800,
    };
    assert({
      given:
        'one peer’s turn ended and one attempt spent, then another peer’s earlier turn ending late',
      should: 'keep owing the turn spoken last, with its attempt still counted',
      actual: after(respondent, turnEnded(5), woke, failed, late),
      expected: {
        duty: {
          status: 'owed',
          to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 5 },
          attempts: 1,
          setbacks: 1,
          paused: true,
        },
        midTurn: [],
        effects: ['drop', 'start', 'retry-soon'],
      },
    });
  });
  test('speech too brief to be a turn owes nothing, unless the bot was cut for it', () => {
    assert({
      given:
        'the asking seat’s question, then 350 ms of peer sound that starts and ends',
      should:
        'count as the peer speaking (the question is not pressed) but owe no answer',
      actual: after(
        asker,
        woke,
        { type: 'delivered' },
        spoke(false),
        turnEnded(5, 350),
        { type: 'silence-elapsed' },
      ),
      expected: {
        duty: { status: 'waiting', unanswered: false, yielded: null },
        midTurn: [],
        effects: ['start', 'drop', 'await-reply'],
      },
    });
    assert({
      given: 'the same with 450 ms of speech',
      should: 'owe an answer to it',
      actual: after(asker, woke, { type: 'delivered' }, turnEnded(5, 450)).duty
        .status,
      expected: 'owed',
    });
    assert({
      given: 'a brief sound while an answer to an earlier turn is prepared',
      should: 'leave that answer alone',
      actual: after(respondent, turnEnded(1), woke, turnEnded(2, 350)).effects,
      expected: ['drop', 'start'],
    });
    assert({
      given: 'a brief sound that talked over the bot and cut it',
      should: 'still be answered: the bot stopped for it',
      actual: after(asker, woke, spoke(true), turnEnded(3, 350)).duty.status,
      expected: 'owed',
    });
  });
  test('a brief sound after a real question never loses its answer', () => {
    const stoodDown = (rules: DutyRules, ...opening: DutyEvent[]) =>
      after(
        rules,
        ...opening,
        turnEnded(4),
        woke,
        // A cough while the turn still waits for the question's line.
        spoke(false, false),
        turnEnded(5, 350),
      ).duty;
    const owedAgain = {
      status: 'owed' as const,
      to: { kind: 'peer-turn' as const, peer: 'p', spokeUntilMs: 4 },
      attempts: 0,
      setbacks: 0,
      paused: false,
    };
    assert({
      given:
        'a real question, the answer started but nothing bought, then a 350 ms sound from the peer, for the respondent and for the asking seat',
      should: 'owe the answer to the real question again',
      actual: [
        stoodDown(respondent),
        stoodDown(asker, woke, { type: 'delivered' }),
      ],
      expected: [owedAgain, owedAgain],
    });
    assert({
      given:
        'a turn that had already spent an attempt, stood down for a sound that proves brief',
      should: 'be owed again with that attempt still counted',
      actual: after(
        respondent,
        turnEnded(4),
        woke,
        { type: 'failed', unusable: true },
        resumed,
        woke,
        spoke(false, false),
        turnEnded(5, 350),
      ).duty,
      expected: { ...owedAgain, attempts: 1, setbacks: 1 },
    });
    assert({
      given: 'the same, but the peer goes on for 450 ms',
      should: 'owe an answer to what they went on to say',
      actual: after(
        respondent,
        turnEnded(4),
        woke,
        spoke(false, false),
        turnEnded(5, 450),
      ).duty,
      expected: {
        ...owedAgain,
        to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 5 },
      },
    });
    assert({
      given:
        'the bot talked over by one peer, then a brief sound from another peer ending first',
      should: 'not answer the other peer’s sound',
      actual: after(asker, woke, spoke(true), {
        type: 'peer-turn-ended',
        peer: 'q',
        spokeUntilMs: 3,
        spokeForMs: 350,
      }).duty.status,
      expected: 'waiting',
    });
  });
  test('nothing starts, or is bought, while a peer is mid-turn', () => {
    const held = after(respondent, turnEnded(1), spoke(false), woke);
    assert({
      given:
        'a peer who speaks again after their turn ended and before the next wake',
      should: 'keep the answer owed and start nothing',
      actual: [held.duty.status, held.effects],
      expected: ['owed', ['drop']],
    });
    assert({
      given: 'that peer’s further speech proving brief, then a wake',
      should: 'start the answer to the turn that was owed',
      actual: after(
        respondent,
        turnEnded(1),
        spoke(false),
        woke,
        turnEnded(2, 350),
        woke,
      ).duty,
      expected: {
        status: 'speaking',
        to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 1 },
        attempts: 0,
        setbacks: 0,
      },
    });
  });
  test('attempts are counted per owed turn', () => {
    const spent = after(
      respondent,
      turnEnded(1),
      woke,
      failed,
      resumed,
      woke,
      failed,
    );
    assert({
      given: 'two failed attempts at one peer turn',
      should: 'give that turn up and wait',
      actual: spent.duty,
      expected: { status: 'waiting', unanswered: false, yielded: null },
    });
    assert({
      given: 'a later peer turn after a spent one',
      should: 'be owed with no attempt spent',
      actual: after(
        respondent,
        turnEnded(1),
        woke,
        failed,
        resumed,
        woke,
        failed,
        turnEnded(2),
      ).duty,
      expected: {
        status: 'owed',
        to: { kind: 'peer-turn', peer: 'p', spokeUntilMs: 2 },
        attempts: 0,
        setbacks: 0,
        paused: false,
      },
    });
  });
  test('changed authority drops a cross-examination answer but keeps the turn owed', () => {
    assert({
      given: 'a conflict while answering',
      should: 'stay owed, drop what was prepared and wake again soon',
      actual: after(respondent, turnEnded(1), woke, {
        type: 'deferred',
        authorityChanged: true,
      }).effects.slice(2),
      expected: ['drop', 'retry-soon'],
    });
  });
  test('the asking seat presses an unanswered question once', () => {
    const asked = after(asker, woke, { type: 'delivered' });
    assert({
      given: 'the asking seat’s question delivered',
      should: 'wait for a reply and start counting the silence',
      actual: asked,
      expected: {
        duty: { status: 'waiting', unanswered: true, yielded: null },
        midTurn: [],
        effects: ['start', 'drop', 'await-reply'],
      },
    });
    assert({
      given: 'silence, the pressing delivered, then silence again',
      should: 'press once and then only wait',
      actual: after(
        asker,
        woke,
        { type: 'delivered' },
        { type: 'silence-elapsed' },
        woke,
        { type: 'delivered' },
        { type: 'silence-elapsed' },
      ).duty,
      expected: { status: 'waiting', unanswered: false, yielded: null },
    });
    assert({
      given: 'a peer who starts to reply before the silence elapses',
      should: 'not press the question',
      actual: after(asker, woke, { type: 'delivered' }, spoke(false), {
        type: 'silence-elapsed',
      }).duty,
      expected: { status: 'waiting', unanswered: false, yielded: null },
    });
    assert({
      given: 'the respondent’s answer delivered, then silence',
      should: 'never press',
      actual: after(
        respondent,
        turnEnded(1),
        woke,
        { type: 'delivered' },
        { type: 'silence-elapsed' },
      ).duty,
      expected: { status: 'waiting', unanswered: false, yielded: null },
    });
  });
  test('a turn already replaced has no say over what replaced it', () => {
    assert({
      given: 'a late failure from a turn that a barge-in already cut',
      should: 'leave the duty as the barge-in left it',
      actual: after(asker, woke, spoke(true), failed).duty,
      expected: {
        status: 'waiting',
        unanswered: false,
        yielded: { kind: 'audio', peer: 'p' },
      },
    });
  });
  test('a stopped claim is over', () => {
    assert({
      given: 'a stop while speaking',
      should: 'stop the turn and be over',
      actual: after(asker, woke, { type: 'stopped' }),
      expected: {
        duty: { status: 'over' },
        midTurn: [],
        effects: ['start', 'restart', 'drop'],
      },
    });
  });
});
