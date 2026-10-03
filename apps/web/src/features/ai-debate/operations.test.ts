import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { setup } from './operations.test-support';

setupRitewayBun();

describe('start and view', () => {
  test('a person starts an AI debate and only they can see it', async () => {
    const { operations, begin } = setup();
    const id = await begin();
    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'a new AI debate with untidy spacing in the resolution',
      should: 'store the tidied resolution and the start command',
      actual: {
        resolution: view.resolution,
        commands: view.commands.map((c) => c.type),
      },
      expected: {
        resolution: 'Social media does more harm than good',
        commands: ['start'],
      },
    });
    await assertRejects({
      given: 'another actor asking for it',
      should: 'answer NOT_FOUND',
      actual: () => operations.view({ actorId: 'actor-2', id }),
      code: 'NOT_FOUND',
    });
  });

  test('refuses an unknown voice and an empty resolution', async () => {
    const { operations } = setup();
    await assertRejects({
      given: 'a voice not on the list',
      should: 'refuse with VALIDATION',
      actual: () =>
        operations.start({
          actorId: 'a',
          resolution: 'Resolved: x y',
          personSide: 'negative',
          voice: 'robot',
        }),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'a resolution of two characters',
      should: 'refuse with VALIDATION',
      actual: () =>
        operations.start({
          actorId: 'a',
          resolution: 'ok',
          personSide: 'negative',
          voice: 'am_michael',
        }),
      code: 'VALIDATION',
    });
  });
});

describe('commands and the ballot', () => {
  test('a refused command changes nothing', async () => {
    const { operations, begin, store } = setup();
    const id = await begin();
    await assertRejects({
      given: 'a startSpeech while the AC is live',
      should: 'refuse with CONFLICT',
      actual: () =>
        operations.command({
          actorId: 'actor-1',
          id,
          command: { type: 'startSpeech' },
          expectedSequence: 1,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused command',
      should: 'leave one command in the log',
      actual: store.records.get(id)?.commands.length,
      expected: 1,
    });
  });

  test('judges once after the last turn', async () => {
    const { operations, begin, time, voice, store } = setup({
      personSide: 'affirmative',
    });
    const id = await begin();
    await assertRejects({
      given: 'a ballot request mid-debate',
      should: 'refuse with CONFLICT',
      actual: () => operations.ballot({ actorId: 'actor-1', id }),
      code: 'CONFLICT',
    });
    time.advance(3 * 3600);
    const first = await operations.ballot({ actorId: 'actor-1', id });
    const second = await operations.ballot({ actorId: 'actor-1', id });
    assert({
      given: 'two ballot requests after the debate ended',
      should: 'judge once, return the same ballot and finish the debate',
      actual: {
        winner: [first.winner, second.winner],
        judgeCalls: voice.calls.filter((call) => call.startsWith('complete'))
          .length,
        finished: store.records.get(id)?.finishedAt !== null,
      },
      expected: {
        winner: ['affirmative', 'affirmative'],
        judgeCalls: 1,
        finished: true,
      },
    });
  });
});
