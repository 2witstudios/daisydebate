import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialSpeakerState,
  nextSpeakerState,
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
const turnEnded = (spokeUntilMs: number): DutyEvent => ({
  type: 'peer-turn-ended',
  peer: 'p',
  spokeUntilMs,
});
const spoke = (audible: boolean): DutyEvent => ({
  type: 'peer-spoke',
  peer: 'p',
  audible,
});
const failed: DutyEvent = { type: 'failed', unusable: false };

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
        duty: { status: 'owed', to: { kind: 'opening' }, attempts: 0 },
        midTurn: [],
        effects: ['start', 'retry-soon'],
      },
    });
  });
  test('ends after its attempts are spent, and at a final refusal', () => {
    assert({
      given: 'two failed attempts',
      should: 'retry once, then be over',
      actual: after(speech, woke, failed, woke, failed).duty,
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
        duty: { status: 'speaking', to: { kind: 'opening' }, attempts: 0 },
        midTurn: [],
        effects: ['start'],
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
        { status: 'owed', to: { kind: 'opening' }, attempts: 0 },
        { status: 'waiting', unanswered: false },
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
          to: { kind: 'peer-turn', spokeUntilMs: 1 },
          attempts: 0,
        },
        midTurn: ['p'],
        effects: ['drop', 'start'],
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
        duty: { status: 'waiting', unanswered: false },
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
          to: { kind: 'peer-turn', spokeUntilMs: 9 },
          attempts: 0,
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
          to: { kind: 'peer-turn', spokeUntilMs: 2 },
          attempts: 0,
        },
        midTurn: [],
        effects: ['drop', 'start', 'restart'],
      },
    });
  });
  test('attempts are counted per owed turn', () => {
    const spent = after(respondent, turnEnded(1), woke, failed, woke, failed);
    assert({
      given: 'two failed attempts at one peer turn',
      should: 'give that turn up and wait',
      actual: spent.duty,
      expected: { status: 'waiting', unanswered: false },
    });
    assert({
      given: 'a later peer turn after a spent one',
      should: 'be owed with no attempt spent',
      actual: after(
        respondent,
        turnEnded(1),
        woke,
        failed,
        woke,
        failed,
        turnEnded(2),
      ).duty,
      expected: {
        status: 'owed',
        to: { kind: 'peer-turn', spokeUntilMs: 2 },
        attempts: 0,
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
        duty: { status: 'waiting', unanswered: true },
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
      expected: { status: 'waiting', unanswered: false },
    });
    assert({
      given: 'a peer who starts to reply before the silence elapses',
      should: 'not press the question',
      actual: after(asker, woke, { type: 'delivered' }, spoke(false), {
        type: 'silence-elapsed',
      }).duty,
      expected: { status: 'waiting', unanswered: false },
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
      expected: { status: 'waiting', unanswered: false },
    });
  });
  test('a turn already replaced has no say over what replaced it', () => {
    assert({
      given: 'a late failure from a turn that a barge-in already cut',
      should: 'leave the duty as the barge-in left it',
      actual: after(asker, woke, spoke(true), failed).duty,
      expected: { status: 'waiting', unanswered: false },
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
