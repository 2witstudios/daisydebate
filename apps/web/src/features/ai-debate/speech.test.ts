import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { setup } from './operations.test-support';

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
});
