import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  openFirstCrossExamination,
  setup,
  speakOpeningConstructive,
} from './operations.test-support';

setupRitewayBun();

/**
 * Cross-examination is turn by turn: one side asks, the other answers. The AI
 * asks when the exchange is its own segment and nothing has been said in that
 * exchange yet — including the case where the debate has been running for
 * minutes, because a cross-examination follows the constructive.
 *
 * The opening test counted utterances across the *whole round*. That count is
 * zero only before a single word has been spoken anywhere, so in any normal
 * debate it was already non-zero when the AI's cross-examination segment
 * opened. The AI therefore sat silent through its own question segment, and
 * the exchange could only begin if the debate happened to start with
 * cross-examination.
 */
describe('the AI opens its own cross-examination', () => {
  test('a transcription finishing after CX closes leaves no late line', async () => {
    let resolveTranscript: (value: { text: string }) => void = () => undefined;
    let started: () => void = () => undefined;
    const transcribing = new Promise<void>((resolve) => (started = resolve));
    const transcript = new Promise<{ text: string }>(
      (resolve) => (resolveTranscript = resolve),
    );
    const { operations, begin, clock } = setup(undefined, () => {
      started();
      return transcript;
    });
    const id = await begin();
    await openFirstCrossExamination(operations, clock, id);
    const pending = operations.crossExamine({
      actorId: 'actor-1',
      id,
      segmentIndex: 1,
      audio: { base64: 'QUJDRA==', format: 'webm' },
    });
    await transcribing;
    clock.advance(130);
    await operations.view({ actorId: 'actor-1', id });
    resolveTranscript({ text: 'Too late for CX.' });
    await assertRejects({
      given: 'speech recognition returns after its cross-examination closes',
      should: 'refuse the line at the durable segment boundary',
      actual: () => pending,
      code: 'CONFLICT',
    });
    assert({
      given: 'the late transcript was refused',
      should: 'leave the round transcript without that line',
      actual: (
        await operations.view({ actorId: 'actor-1', id })
      ).utterances.some((line) => line.text === 'Too late for CX.'),
      expected: false,
    });
  });

  test('asks its first question after the constructive has been spoken', async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();

    // Speak the constructive first, so the round transcript is non-empty —
    // the state in which the AI used to stay silent.
    await speakOpeningConstructive(operations, clock, id);
    await operations.speech({
      actorId: 'actor-1',
      id,
      segmentIndex: 0,
    });

    const beforeCx = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'a debate whose constructive has been spoken',
      should: 'already hold lines, so the round transcript is not empty',
      actual: beforeCx.utterances.length > 0,
      expected: true,
    });

    // Move to the AI's own cross-examination segment — the side opposite the
    // person's — and ask it to open.
    const aiCxIndex = beforeCx.rules.segments.findIndex(
      (segment) =>
        segment.type === 'cross_ex' && segment.side !== beforeCx.personSide,
    );
    // Advance to the middle of that segment's own window: the opening is only
    // legal while the segment is live (or in the countdown that opens it).
    const target = beforeCx.rules.segments[aiCxIndex]!;
    const elapsedBefore = beforeCx.rules.segments
      .slice(0, aiCxIndex)
      .reduce((sum, segment) => sum + segment.durationMs, 0);
    clock.advance(elapsedBefore / 1000 + target.durationMs / 2000);

    const result = await operations.crossExamine({
      actorId: 'actor-1',
      id,
      segmentIndex: aiCxIndex,
    });

    assert({
      given: "the AI's cross-examination opening with no recording attached",
      should: 'ask its first question rather than staying silent',
      actual: {
        hasReply: result.reply !== null,
        phrases: result.reply?.phrases.length ?? 0,
      },
      expected: { hasReply: true, phrases: 1 },
    });
  });
});
