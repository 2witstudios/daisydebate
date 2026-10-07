import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { setup, speakOpeningConstructive } from './operations.test-support';

setupRitewayBun();

const eventsOf = async (
  generator: AsyncGenerator<{ type: string; id?: string }>,
) => {
  const events: { type: string; id?: string }[] = [];
  for await (const event of generator) events.push(event);
  return events;
};

describe('the AI speech, on the one Round model', () => {
  test('writes the line onto the open segment once time opens it', async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    clock.advance(451); // AC and CX1 done; the AI's NC opens
    const events = await eventsOf(
      operations.speech({ actorId: 'actor-1', id, segmentIndex: 2 }),
    );
    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: "the model's answer, streamed while the AC is live",
      should: 'name the line, then its phrase, and land it on the AC row',
      actual: {
        kinds: events.map((event) => event.type),
        lines: view.utterances.map((line) => ({
          segmentIndex: line.segmentIndex,
          role: line.role,
          text: line.text,
          complete: line.complete,
        })),
      },
      expected: {
        kinds: ['utterance', 'phrase'],
        lines: [
          {
            segmentIndex: 2,
            role: 'ai',
            text: 'A short speech.',
            complete: true,
          },
        ],
      },
    });
  });

  test("refuses to speak over a segment that is not the AI's", async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    clock.advance(11); // the AC opens: the person's speech
    await assertRejects({
      given: "a speech request for the person's own segment",
      should: 'refuse with CONFLICT',
      actual: async () => {
        const generator = operations.speech({
          actorId: 'actor-1',
          id,
          segmentIndex: 0,
        });
        await generator.next();
      },
      code: 'CONFLICT',
    });
  });

  test('the voice budget is spent as characters, per seat', async () => {
    const { operations, begin, clock } = setup({
      live: 25,
      perDay: 20,
      speechCharacters: 5,
    } as never);
    const id = await begin();
    clock.advance(451);
    const events = await eventsOf(
      operations.speech({ actorId: 'actor-1', id, segmentIndex: 2 }),
    );
    const utteranceId = events.find((event) => event.type === 'utterance')!.id!;
    await assertRejects({
      given: 'a voice request once the characters are spent',
      should: 'refuse with RATE_LIMIT',
      actual: () =>
        operations.speak({
          actorId: 'actor-1',
          id,
          utteranceId,
          phraseIndex: 0,
        }),
      code: 'RATE_LIMIT',
    });
  });

  // `speak` and `heard` are both about the AI's voice: one fetches a phrase as
  // mp3, the other rewrites a line down to what the listener actually heard.
  // Both used to accept any utterance the round held, so a client could point
  // either at the person's own transcript.
  test('refuses to voice or rewrite the person’s own utterance', async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    await speakOpeningConstructive(operations, clock, id);
    const view = await operations.view({ actorId: 'actor-1', id });
    const spoken = view.utterances.find((line) => line.role === 'person');
    if (!spoken) throw new Error('the person’s line did not land');

    await assertRejects({
      given: "a voice request naming the person's own utterance",
      should: 'refuse, so the budget cannot be spent on their words',
      actual: () =>
        operations.speak({
          actorId: 'actor-1',
          id,
          utteranceId: spoken.id,
          phraseIndex: 0,
        }),
      code: 'NOT_FOUND',
    });

    const afterSpeak = await operations.view({ actorId: 'actor-1', id });

    await assertRejects({
      given: "a heard report naming the person's own utterance",
      should: 'refuse, so their transcript is not rewritten',
      actual: () =>
        operations.heard({
          actorId: 'actor-1',
          id,
          utteranceId: spoken.id,
          phraseIndex: 0,
          playedMs: 0,
          totalMs: 100,
        }),
      code: 'NOT_FOUND',
    });

    assert({
      given: 'both refused requests',
      should: 'leave the person’s transcript exactly as they spoke it',
      actual: (
        await operations.view({ actorId: 'actor-1', id })
      ).utterances.map((line) => line.text),
      expected: afterSpeak.utterances.map((line) => line.text),
    });
  });
});
