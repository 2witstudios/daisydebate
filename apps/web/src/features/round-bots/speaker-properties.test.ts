import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { seededAsyncDraws } from '@daisy/seeded-random/testing';
import { answered, harness, job } from './speaker.test-support';

setupRitewayBun();

test('generated speech failures preserve purchases, publication order and terminal silence', async () => {
  const proof = await seededAsyncDraws({
    seed: 4321,
    runs: 50,
    draws: 12,
    problems: async (draw) => {
      const count = 1 + draw(6);
      const phrases = Array.from(
        { length: count },
        (_, index) => `Line ${index}.`,
      );
      const failAt = draw(count + 1);
      const attempts = new Map<string, number>();
      const failures = new Map<string, number>();
      const bought = new Map<string, number>();
      const said: string[] = [];
      let generated = 0;
      const world = harness('speech', {
        generate: async () => {
          generated++;
          return answered({ phrases });
        },
        synthesize: async (id, text) => {
          const attempt = (attempts.get(text) ?? 0) + 1;
          attempts.set(text, attempt);
          if (text === phrases[failAt] && attempt === 1) {
            failures.set(text, 1);
            throw createAppError('INFRASTRUCTURE', 'generated voice failure');
          }
          bought.set(text, (bought.get(text) ?? 0) + 1);
          return answered(job(id, text, 24_000 * 5));
        },
        publish: async (phrase) => {
          said.push(phrase.text);
          return { complete: true, segmentEnded: false };
        },
      });
      const problems: string[] = [];
      for (let wake = 0; wake < count + 6; wake++) {
        world.speaker.wake();
        await world.settle();
      }
      if (generated !== 1) problems.push('speech bought more than one answer');
      for (const text of phrases) {
        if (
          (bought.get(text) ?? 0) > 1 ||
          (attempts.get(text) ?? 0) > 1 + (failures.get(text) ?? 0)
        )
          problems.push(
            `${text}: phrase bought twice without a failed attempt`,
          );
      }
      if (!Bun.deepEquals(said, phrases))
        problems.push(`lines out of order or missing: ${JSON.stringify(said)}`);
      await world.speaker.stop();
      const before = [...world.log];
      const purchases = [...attempts];
      const published = [...said];
      const laterEvents = 1 + draw(6);
      for (let event = 0; event < laterEvents; event++) {
        world.speaker.wake();
        world.speaker.peer({ kind: 'speech-start', peer: 'peer' });
        world.elapse();
        world.elapsePause();
        await world.settle();
      }
      if (
        !Bun.deepEquals(world.log, before) ||
        !Bun.deepEquals([...attempts], purchases) ||
        !Bun.deepEquals(said, published)
      )
        problems.push('effects occurred after over');
      return problems;
    },
  });
  assert({
    given:
      'seed4321 generated phrase lists, one failed voice and repeated wakes',
    should:
      'buy once except failed attempts, say lines in order, and emit no effects after over',
    actual: proof.failure,
    expected: null,
  });
});

test('generated peer turns are answered once and never published over peer speech', async () => {
  const proof = await seededAsyncDraws({
    seed: 4322,
    runs: 50,
    draws: 30,
    problems: async (draw) => {
      const answers = new Map<number, number>();
      const problems: string[] = [];
      let peerMidTurn = false;
      let published = 0;
      const world = harness('cross_ex', {
        opensExchange: false,
        generate: async (to) => {
          if (to.kind !== 'peer-turn')
            problems.push('respondent answered without a peer turn');
          else
            answers.set(
              to.spokeUntilMs,
              (answers.get(to.spokeUntilMs) ?? 0) + 1,
            );
          return answered({ phrases: ['Because.'] });
        },
        publish: async () => {
          if (peerMidTurn) problems.push('published while peer mid-turn');
          published++;
          return { complete: true, segmentEnded: false };
        },
      });
      const turns = 1 + draw(5);
      for (let turn = 0; turn < turns; turn++) {
        const first = (turn * 2 + 1) * 1000;
        world.speaker.peer({
          kind: 'end-of-turn',
          peer: 'peer',
          spokeUntilMs: first,
          spokeForMs: 800,
        });
        world.speaker.wake();
        // The peer resumes before asynchronous preparation may publish.
        peerMidTurn = true;
        world.speaker.peer({ kind: 'speech-start', peer: 'peer' });
        const before = published;
        const wakes = 1 + draw(4);
        for (let wake = 0; wake < wakes; wake++) {
          world.speaker.wake();
          await world.settle();
        }
        if (published !== before)
          problems.push('a held answer began during peer speech');
        peerMidTurn = false;
        const ended = {
          kind: 'end-of-turn' as const,
          peer: 'peer',
          spokeUntilMs: first + 1000,
          spokeForMs: 800,
        };
        const duplicates = 1 + draw(4);
        for (let duplicate = 0; duplicate < duplicates; duplicate++) {
          world.speaker.peer(ended);
          world.speaker.wake();
          await world.settle();
        }
        await world.settle();
      }
      await world.speaker.stop();
      if ([...answers.values()].some((count) => count > 1))
        problems.push('peer turn answered more than once');
      if (published !== turns)
        problems.push(
          `expected ${turns} current-turn answers, got ${published}`,
        );
      return problems;
    },
  });
  assert({
    given:
      'seed4322 peer turns, duplicate end reports and wakes while the peer resumes',
    should:
      'answer each current turn once and publish nothing during peer speech',
    actual: proof.failure,
    expected: null,
  });
});

test('generated timed speaker waits wake without an external pulse', async () => {
  const proof = await seededAsyncDraws({
    seed: 4323,
    runs: 30,
    draws: 3,
    problems: async (draw) => {
      const refusals = 1 + draw(4);
      let generated = 0;
      const problems: string[] = [];
      const retry = harness('speech', {
        generate: async () => {
          generated++;
          if (generated <= refusals)
            throw createAppError('CONFLICT', 'not yet authorized');
          return answered({ phrases: ['Ready.'] });
        },
      });
      retry.speaker.wake();
      for (let pause = 0; pause < refusals; pause++) {
        await retry.settle();
        if (retry.pendingTimers().pauses !== 1)
          problems.push('retry wait has no owned timer');
        retry.elapsePause();
      }
      await retry.settle();
      if (generated !== refusals + 1)
        problems.push('retry timer did not resume the owed turn');
      await retry.speaker.stop();
      let questions = 0;
      const asking = harness('cross_ex', {
        generate: async () => {
          questions++;
          return answered({ phrases: ['Why?'] });
        },
        publish: async () => ({ complete: true, segmentEnded: false }),
      });
      asking.speaker.wake();
      const settles = 2 + draw(4);
      for (let wake = 0; wake < settles; wake++) await asking.settle();
      if (asking.pendingTimers().replies !== 1)
        problems.push('unanswered-question wait has no timer');
      asking.elapse();
      await asking.settle();
      if (questions !== 2)
        problems.push('reply timer did not press the unanswered question');
      await asking.speaker.stop();
      if (
        asking.pendingTimers().pauses +
          asking.pendingTimers().replies +
          retry.pendingTimers().pauses +
          retry.pendingTimers().replies !==
        0
      )
        problems.push('a timer survived claim end');
      return problems;
    },
  });
  assert({
    given: 'seed4323 generated refusal counts and unanswered questions',
    should:
      'own a timer for every retry/silence wait and cancel all timers after over',
    actual: proof.failure,
    expected: null,
  });
});

test('a respondent waiting only for peer input has no self-wake timer', async () => {
  const world = harness('cross_ex', { opensExchange: false });
  world.speaker.wake();
  await world.settle();
  assert({
    given: 'a respondent before any peer turn has ended',
    should:
      'preserve event-driven silence rather than invent an unanswered-question timer',
    actual: { log: world.log, timers: world.pendingTimers() },
    expected: { log: [], timers: { pauses: 0, replies: 0 } },
  });
  await world.speaker.stop();
});
