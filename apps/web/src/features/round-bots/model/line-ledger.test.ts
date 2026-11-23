import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyLineLedger,
  nextLineLedger,
  lineTailCut,
  lineCredit,
  lineClosed,
} from './line-ledger';

setupRitewayBun();

describe('bot line ledger', () => {
  test('a clear cuts only audio already handed over, including within one millisecond', () => {
    const handoff = {
      type: 'handed',
      phraseId: 'line',
      sentSamples: 14400,
      phraseSamples: 14400,
      playsUntilMs: 910,
    } as const;
    const before = nextLineLedger(emptyLineLedger(), {
      type: 'clear',
      atMs: 600,
    }).state;
    const handed = nextLineLedger(nextLineLedger(before, handoff).state, {
      type: 'reported',
      phraseId: 'line',
    }).state;
    const cut = nextLineLedger(handed, { type: 'clear', atMs: 600 }).state;
    assert({
      given: 'a clear before the handoff at the same millisecond',
      should: 'retain the whole queued phrase',
      actual: lineTailCut(handed, 'line'),
      expected: false,
    });
    assert({
      given: 'a clear after the handoff at the same millisecond',
      should: 'record the dropped tail',
      actual: lineTailCut(cut, 'line'),
      expected: true,
    });
    assert({
      given: 'a 600ms phrase whose last 310ms were dropped',
      should: 'credit only the 290ms handed and played',
      actual: lineCredit(cut, 'line'),
      expected: 290 / 600,
    });
  });
  test('a later phrase not yet reported said cannot hide a cut of the previous queued tail', () => {
    let state = emptyLineLedger();
    for (const phraseId of ['reported', 'still-revealing']) {
      state = nextLineLedger(state, {
        type: 'handed',
        phraseId,
        sentSamples: 14400,
        phraseSamples: 14400,
        playsUntilMs: 900,
      }).state;
      if (phraseId === 'reported')
        state = nextLineLedger(state, { type: 'reported', phraseId }).state;
    }
    state = nextLineLedger(state, { type: 'clear', atMs: 600 }).state;
    assert({
      given: 'the next short phrase whose reveal has not succeeded',
      should: 'still identify the previous reported phrase whose tail was cut',
      actual: lineTailCut(state, 'reported'),
      expected: true,
    });
  });
  test('an unacknowledged end closes the line immediately and retries only its original credit', () => {
    const pending = nextLineLedger(emptyLineLedger(), {
      type: 'end',
      phraseId: 'line',
      end: { kind: 'cut', spoken: 'some', playedMs: 400 },
    });
    const duplicate = nextLineLedger(pending.state, {
      type: 'end',
      phraseId: 'line',
      end: { kind: 'whole' },
    });
    const failed = nextLineLedger(pending.state, {
      type: 'end-result',
      phraseId: 'line',
      retry: true,
    }).state;
    const retry = nextLineLedger(failed, { type: 'retry' });
    const overlapping = nextLineLedger(retry.state, { type: 'retry' });
    const done = nextLineLedger(retry.state, {
      type: 'end-result',
      phraseId: 'line',
      retry: false,
    }).state;
    assert({
      given: 'an end whose reply may have been lost',
      should:
        'fence the old line and preserve original credited audio through one retry at a time',
      actual: {
        closed: lineClosed(pending.state, 'line'),
        duplicate: duplicate.effects,
        retry: retry.effects,
        overlapping: overlapping.effects,
        done: nextLineLedger(done, { type: 'retry' }).effects,
      },
      expected: {
        closed: true,
        duplicate: [],
        retry: [
          {
            type: 'end',
            phraseId: 'line',
            end: { kind: 'cut', spoken: 'some', playedMs: 400 },
          },
        ],
        overlapping: [],
        done: [],
      },
    });
  });
});
